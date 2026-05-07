import { prisma } from "@/lib/prisma";
import { generateAgentResponse } from "@/lib/ai";
import { debitTokens, estimateTaskCost } from "@/lib/tokens";
import { writeLog } from "@/lib/logs";
import { createOpenCodeSession } from "@/lib/opencode";
import { getBillingModel } from "@/lib/models";
import { logError } from "@/lib/error-logger";

type ExecuteTaskInput = {
  taskId: string;
  approved?: boolean;
  billingModelCode?: string | null;
  images?: string[];
};

export async function executeTask(input: ExecuteTaskInput) {
  const task = await prisma.agentTask.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      agent: true,
      conversation: true,
      user: true,
    },
  });

  await prisma.agentTask.update({
    where: { id: task.id },
    data: { status: "RUNNING" },
  });

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

  const useOpenCodeOnly = process.env.FORCE_OPENCODE_ONLY === "true";

  try {
    generated = await generateAgentResponse({
      userId: task.userId,
      prompt: task.prompt,
      agentName: task.agent?.name ?? "Code Pilot",
      conversationId: conversation.id,
      opencodeSessionId: conversation.opencodeSessionId,
      billingModelCode: selectedModel.code,
      images: input.images,
    });
  } catch (error) {
    logError("Model generation failed", error, { taskId: task.id, userId: task.userId });

    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The model request timed out. Try again, or set MODEL_REQUEST_TIMEOUT_MS higher on the server."
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

  await prisma.message.create({
    data: {
      userId: task.userId,
      conversationId: conversation.id,
      role: "USER",
      content: task.prompt,
      tokenEstimate: Math.ceil(task.prompt.length / 4),
    },
  });

  await prisma.message.create({
    data: {
      userId: task.userId,
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: assistantContent,
      tokenEstimate: tokenCost,
      modelUsed: generated.model ?? selectedModel.openRouterModel ?? selectedModel.code,
    },
  });

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
          if (file.path && file.content) {
            await prisma.userFile.upsert({
              where: { userId_path: { userId: task.userId, path: file.path } },
              update: { content: file.content, sizeBytes: Buffer.byteLength(file.content, "utf-8") },
              create: {
                userId: task.userId,
                path: file.path,
                content: file.content,
                sizeBytes: Buffer.byteLength(file.content, "utf-8"),
              },
            });
          }
        }
      }
    }
  } catch {
    // Non-critical — don't fail the task if workspace save fails
  }

  const updated = await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      status: "COMPLETED",
      conversationId: conversation.id,
      result: assistantContent,
      tokenCost,
    },
  });

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
        useOpenCodeOnly && input.billingModelCode ? "opencode" : input.billingModelCode ? "opencode_or_openrouter" : "openrouter",
    },
  });

  return updated;
}
