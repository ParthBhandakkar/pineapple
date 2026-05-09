import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { classifyRisk } from "@/lib/risk";
import {
  estimateChargeWithMultiplier,
  getActiveEntitlement,
  resetSubscriptionTokensIfNeeded,
} from "@/lib/tokens";
import { runAgentLoop } from "@/lib/tools/agent-loop";
import { getBillingModel } from "@/lib/models";
import { writeLog } from "@/lib/logs";
import { logError } from "@/lib/error-logger";
import { isTestingUnlimited } from "@/lib/testing-unlimited";

const streamSchema = z.object({
  prompt: z.string().min(1).max(700_000),
  agentId: z.string().optional(),
  conversationId: z.string().optional(),
  modelCode: z.string().optional(),
  images: z.array(z.string().max(30_000_000)).max(5).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = streamSchema.parse(await request.json());

    const entitlement = await getActiveEntitlement(user.id);
    const selectedModel = getBillingModel(body.modelCode);
    const testingUnlimited = isTestingUnlimited();

    if (!testingUnlimited) {
      const wallet = await resetSubscriptionTokensIfNeeded(user.id);
      const tokenCost = estimateChargeWithMultiplier(body.prompt, selectedModel.multiplier);

      if (wallet.subscriptionTokensRemaining + wallet.purchasedTokensRemaining < tokenCost) {
        throw new HttpError(402, "Insufficient token balance. Please upgrade or buy a token pack.");
      }
    }

    const conversation = body.conversationId
      ? await prisma.conversation.findFirst({
          where: { id: body.conversationId, userId: user.id },
          select: { id: true, isAgentMode: true, opencodeSessionId: true },
        })
      : null;

    if (body.conversationId && !conversation) {
      throw new HttpError(404, "Conversation not found");
    }

    const agent = body.agentId
      ? await prisma.userAgent.findFirst({
          where: { userId: user.id, agentId: body.agentId, status: "DEPLOYED" },
          include: { agent: true },
        })
      : await prisma.userAgent.findFirst({
          where: { userId: user.id, status: "DEPLOYED" },
          include: { agent: true },
          orderBy: { deployedAt: "asc" },
        });

    if (!agent) {
      throw new HttpError(400, "No deployed agent is available");
    }

    const risk = classifyRisk(body.prompt);

    const task = await prisma.agentTask.create({
      data: {
        userId: user.id,
        agentId: agent.agentId,
        conversationId: conversation?.id,
        prompt: body.prompt,
        status: risk.isHighRisk ? "PENDING_APPROVAL" : "RUNNING",
        actionType: risk.actionType,
        riskLevel: risk.riskLevel,
        tokenCost: risk.isHighRisk ? 0 : estimateChargeWithMultiplier(body.prompt, selectedModel.multiplier),
      },
    });

    if (risk.isHighRisk) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          title: "Approval required",
          body: `${agent.agent.name} needs approval before ${risk.actionType.toLowerCase().replaceAll("_", " ")}.`,
        },
      });

      return ok({
        status: "PENDING_APPROVAL",
        task,
        approval: { actionType: risk.actionType, reason: risk.reason },
      });
    }

    const conversationId =
      conversation?.id ??
      (
        await prisma.conversation.create({
          data: {
            userId: user.id,
            agentId: agent.agentId,
            title: body.prompt.slice(0, 72) || "New session",
            isAgentMode: true,
          },
        })
      ).id;

    const abortController = new AbortController();
    request.signal.addEventListener("abort", () => abortController.abort());

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(line));
        };

        try {
          send("status", { status: "starting", message: "Agent starting..." });

          const toolCalls: Array<{
            callId: string;
            name: string;
            args: Record<string, unknown>;
            result?: { success: boolean; result?: unknown; error?: string };
          }> = [];

          let streamedSoFar = "";

          const result = await runAgentLoop({
            userId: user.id,
            conversationId,
            prompt: body.prompt,
            billingModelCode: selectedModel.code,
            images: body.images,
            abortSignal: abortController.signal,
            onToolCall: (call) => {
              const tc = { callId: call.callId, name: call.name, args: call.args };
              toolCalls.push(tc);
              send("tool_call", tc);
            },
            onToolResult: (result) => {
              const pending = toolCalls.find((tc) => tc.callId === result.callId);
              if (pending) {
                pending.result = {
                  success: result.success,
                  result: result.result,
                  error: result.error,
                };
              }
              send("tool_result", result);
            },
            onTextChunk: (text) => {
              // Stream incrementally: send only the new characters
              if (text.length > streamedSoFar.length) {
                const chunk = text.slice(streamedSoFar.length);
                streamedSoFar = text;
                send("text_delta", { delta: chunk });
              } else if (text !== streamedSoFar) {
                // Full replacement (e.g. after repair)
                streamedSoFar = text;
                send("text", { content: text });
              }
            },
            onComplete: (finalResult) => {
              send("complete", {
                totalTokens: finalResult.totalTokens,
                inputTokens: finalResult.inputTokens,
                outputTokens: finalResult.outputTokens,
                iterations: finalResult.iterations,
                toolCalls: finalResult.toolCalls,
                model: finalResult.model,
              });
            },
          });

          // Save messages to DB after completion
          try {
            const tokenCost = Math.max(1, Math.ceil(result.totalTokens * selectedModel.multiplier));

            await prisma.message.create({
              data: {
                userId: user.id,
                conversationId,
                role: "USER",
                content: body.prompt,
                tokenEstimate: Math.ceil(body.prompt.length / 4),
              },
            });

            if (result.content) {
              await prisma.message.create({
                data: {
                  userId: user.id,
                  conversationId,
                  role: "ASSISTANT",
                  content: result.content,
                  tokenEstimate: tokenCost,
                  modelUsed: result.model,
                },
              });
            }

            await prisma.conversation.update({
              where: { id: conversationId },
              data: { updatedAt: new Date() },
            });

            await prisma.agentTask.update({
              where: { id: task.id },
              data: {
                status: "COMPLETED",
                result: result.content,
                tokenCost,
                conversationId,
              },
            });

            await prisma.notification.create({
              data: {
                userId: user.id,
                title: "Task completed",
                body: `${agent.agent.name} finished: ${body.prompt.slice(0, 80)}`,
              },
            });

            await writeLog({
              userId: user.id,
              taskId: task.id,
              event: "task.completed",
              summary: `Agent completed ${result.iterations} iterations with ${result.toolCalls} tool calls`,
              metadata: {
                conversationId,
                totalTokens: result.totalTokens,
                iterations: result.iterations,
                toolCalls: result.toolCalls,
                model: result.model,
              },
            });
          } catch (dbError) {
            logError("Failed to save task results", dbError, { taskId: task.id, userId: user.id });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Agent loop failed";
          send("error", { message: errorMessage });

          if (!(error instanceof Error && error.name === "AbortError")) {
            await prisma.agentTask.update({
              where: { id: task.id },
              data: { status: "FAILED", result: errorMessage },
            });
          }
          logError("Stream error", error, { taskId: task.id });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return fail(error);
  }
}