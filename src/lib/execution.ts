import { prisma } from "@/lib/prisma";
import { generateAgentResponse } from "@/lib/ai";
import { debitTokens, estimateTaskCost } from "@/lib/tokens";
import { writeLog } from "@/lib/logs";
import { createOpenCodeSession } from "@/lib/opencode";
import { getBillingModel } from "@/lib/models";
import { logError } from "@/lib/error-logger";

const TASK_EXECUTION_TIMEOUT_MS = Number(process.env.TASK_EXECUTION_TIMEOUT_MS ?? "720000");

type ExecuteTaskInput = {
  taskId: string;
  approved?: boolean;
  billingModelCode?: string | null;
  images?: string[];
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(reason)), timeoutMs);
    }),
  ]);
}

export async function executeTask(input: ExecuteTaskInput) {
  const task = await prisma.agentTask.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      agent: true,
      conversation: true,
      user: true,
    },
  });

  const started = await prisma.agentTask.updateMany({
    where: { id: task.id, status: { in: ["QUEUED", "PENDING_APPROVAL"] } },
    data: { status: "RUNNING" },
  });

  if (started.count === 0) {
    return await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } });
  }

  if (task.conversation && task.conversation.userId !== task.userId) {
    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "FAILED", result: "Task conversation does not belong to the task owner." },
    });
    throw new Error("Task conversation does not belong to the task owner.");
  }

  let conversation =
    task.conversation ??
    (await prisma.conversation.create({
      data: {
        userId: task.userId,
        agentId: task.agentId,
        title: task.prompt.slice(0, 72) || "New session",
      },
    }));

  if (!conversation.opencodeSessionId && process.env.OPENCODE_SERVER_URL) {
    const openCodeSession = await createOpenCodeSession(conversation.title).catch((err) => {
      logError("OpenCode session bootstrap failed", err, {
        userId: task.userId,
        conversationId: conversation.id,
      });
      return null;
    });

    if (openCodeSession?.id) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { opencodeSessionId: openCodeSession.id },
      });
    }
  }

  const estimatedBaseTokens = estimateTaskCost(task.prompt);
  const selectedModel = getBillingModel(input.billingModelCode);

  let generated: Awaited<ReturnType<typeof generateAgentResponse>>;

  try {
    generated = await withTimeout(
      generateAgentResponse({
        userId: task.userId,
        prompt: task.prompt,
        agentName: task.agent?.name ?? "Code Pilot",
        conversationId: conversation.id,
        opencodeSessionId: conversation.opencodeSessionId,
        billingModelCode: selectedModel.code,
        images: input.images,
      }),
      TASK_EXECUTION_TIMEOUT_MS,
      `Task execution exceeded ${TASK_EXECUTION_TIMEOUT_MS}ms`,
    );
  } catch (error) {
    logError("Model generation failed", error, { taskId: task.id, userId: task.userId });

    const latestTaskState = await prisma.agentTask.findUnique({
      where: { id: task.id },
    });

    if (latestTaskState && latestTaskState.status !== "RUNNING") {
      await writeLog({
        userId: task.userId,
        taskId: task.id,
        level: "WARN",
        event: "task.execution.superseded",
        summary: `Task failure was discarded because the task is already ${latestTaskState.status}.`,
        metadata: { currentStatus: latestTaskState.status, currentResult: latestTaskState.result ?? null },
      });
      return latestTaskState;
    }

    const message =
      error instanceof Error &&
      (error.name === "AbortError" || /timed out|timeout|exceeded/i.test(error.message))
        ? "The model request timed out. Please retry. We have automatically stopped this run to avoid getting stuck."
        : error instanceof Error
          ? error.message
          : "Failed to generate response from model service";
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        result: message,
      },
    });
    throw error;
  }

  const latestTaskState = await prisma.agentTask.findUnique({
    where: { id: task.id },
  });

  if (latestTaskState && latestTaskState.status !== "RUNNING") {
    await writeLog({
      userId: task.userId,
      taskId: task.id,
      level: "WARN",
      event: "task.execution.superseded",
      summary: `Task result was discarded because the task is already ${latestTaskState.status}.`,
      metadata: { currentStatus: latestTaskState.status, currentResult: latestTaskState.result ?? null },
    });
    return latestTaskState;
  }

  const usageTokens = generated.totalTokens ?? estimatedBaseTokens;

  const tokenCost = Math.max(1, Math.ceil(usageTokens * selectedModel.multiplier));
  const assistantContent = generated.fallbackNotice
    ? `${generated.fallbackNotice}\n\n${generated.content}`
    : generated.content;

  try {
    await debitTokens(task.userId, tokenCost, "Agent task execution", {
      taskId: task.id,
      approved: Boolean(input.approved),
      billingModel: selectedModel.code,
      multiplier: selectedModel.multiplier,
      usageTokens,
    });
  } catch (error) {
    logError("Token debit failed", error, { taskId: task.id, userId: task.userId });
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        result: error instanceof Error ? error.message : "Unable to debit tokens for task execution",
      },
    });
    throw error;
  }

  let updated;
  try {
    const conversationRecord = await prisma.conversation.findFirst({
      where: { id: conversation.id, userId: task.userId },
    });
    if (!conversationRecord) {
      conversation = await prisma.conversation.create({
        data: {
          userId: task.userId,
          agentId: task.agentId,
          title: task.prompt.slice(0, 72) || "New session",
          opencodeSessionId: conversation.opencodeSessionId ?? null,
        },
      });
    } else {
      conversation = conversationRecord;
    }

    updated = await prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          userId: task.userId,
          conversationId: conversation.id,
          role: "USER",
          content: task.prompt,
          tokenEstimate: Math.ceil(task.prompt.length / 4),
        },
      });

      await tx.message.create({
        data: {
          userId: task.userId,
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: assistantContent,
          tokenEstimate: tokenCost,
          modelUsed: generated.model ?? selectedModel.openRouterModel ?? selectedModel.code,
        },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      return await tx.agentTask.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          conversationId: conversation.id,
          result: assistantContent,
          tokenCost,
        },
      });
    });
  } catch (error) {
    logError("Task persistence failed", error, { taskId: task.id, userId: task.userId, conversationId: conversation.id });
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        result:
          error instanceof Error
            ? `Task failed while saving results: ${error.message}`
            : "Task failed while saving results.",
      },
    });
    throw error;
  }

  // Auto-save project artifact files to user's workspace
  try {
    const artifactMatch = assistantContent.match(/```pineapple-project\s*([\s\S]*?)```/);
    if (artifactMatch) {
      let jsonStr = artifactMatch[1].trim();
      // Handle cases where the JSON might have literal \n in file contents stored as \\n
      let artifact;
      try {
        artifact = JSON.parse(jsonStr);
      } catch {
        // Try normalizing escaped characters
        jsonStr = jsonStr.replace(/\\n/g, "\n").replace(/\\"/g, '"');
        try { artifact = JSON.parse(jsonStr); } catch { /* give up */ }
      }
      if (artifact?.files?.length) {
        for (const file of artifact.files) {
          const normalizedPath = typeof file.path === "string"
            ? file.path
                .trim()
                .replace(/^\/+/, "")
                .replace(/\\/g, "/")
                .replace(/\/+/g, "/")
            : "";
          const normalizedContent = typeof file.content === "string" ? file.content : "";

          if (!normalizedPath) continue;
          if (normalizedPath === "." || normalizedPath === ".." || normalizedPath.startsWith("../") || normalizedPath.includes("/../")) {
            continue;
          }

          await prisma.userFile.upsert({
            where: { userId_path: { userId: task.userId, path: normalizedPath } },
            update: { content: normalizedContent, sizeBytes: Buffer.byteLength(normalizedContent, "utf-8") },
            create: {
              userId: task.userId,
              path: normalizedPath,
              content: normalizedContent,
              sizeBytes: Buffer.byteLength(normalizedContent, "utf-8"),
            },
          });
        }
      }
    }
  } catch {
    // Non-critical — don't fail the task if workspace save fails
  }

  await prisma.notification.create({
    data: {
      userId: task.userId,
      title: "Task completed",
      body: `${task.agent?.name ?? "Agent"} finished: ${task.prompt.slice(0, 80)}`,
    },
  });

  await writeLog({
    userId: task.userId,
    taskId: task.id,
    event: "task.completed",
    summary: `Task completed with ${tokenCost} tokens using ${generated.model ?? "configured model"}.`,
    metadata: {
      conversationId: conversation.id,
      model: generated.model ?? selectedModel.code,
      fallbackNotice: generated.fallbackNotice ?? null,
      provider:
        "opencode",
    },
  });

  return updated;
}
