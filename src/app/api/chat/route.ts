import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { classifyRisk } from "@/lib/risk";
import {
  estimateChargeWithMultiplier,
  estimateTaskCost,
  getActiveEntitlement,
  resetSubscriptionTokensIfNeeded,
} from "@/lib/tokens";
import { executeTask } from "@/lib/execution";
import { writeLog } from "@/lib/logs";
import { logError } from "@/lib/error-logger";
import { getAllowedMaxMultiplier, getBillingModel } from "@/lib/models";

const chatSchema = z.object({
  prompt: z.string().min(1).max(20000),
  agentId: z.string().optional(),
  conversationId: z.string().optional(),
  modelCode: z.string().optional(),
  // Used for backend-only "model sync" prompts that must not be persisted as chat messages.
  silent: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = chatSchema.parse(await request.json());
    const entitlement = await getActiveEntitlement(user.id);
    const selectedModel = getBillingModel(body.modelCode);
    const allowedMaxMultiplier = getAllowedMaxMultiplier(entitlement.plan.code);
    const conversation = body.conversationId
      ? await prisma.conversation.findFirst({
          where: { id: body.conversationId, userId: user.id },
          select: { id: true, opencodeSessionId: true },
        })
      : null;

    if (body.conversationId && !conversation) {
      throw new HttpError(404, "Conversation not found");
    }

    if (body.silent) {
      // Model sync should not create tasks/messages, should not debit tokens,
      // and should not affect the visible chat transcript.
      if (selectedModel.multiplier > allowedMaxMultiplier) {
        throw new HttpError(
          403,
          `Selected model multiplier (×${selectedModel.multiplier}) exceeds your plan limit (max ×${allowedMaxMultiplier}). Upgrade your subscription to use this model.`
        );
      }

      return ok({
        status: "SILENT_OK",
        model: {
          code: selectedModel.code,
          openRouterModel: selectedModel.openRouterModel,
          multiplier: selectedModel.multiplier,
        },
      });
    }

    if (entitlement.plan.code === "free") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dailyTaskCount = await prisma.agentTask.count({
        where: {
          userId: user.id,
          createdAt: { gte: today },
          status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
        },
      });

      if (dailyTaskCount >= 5) {
        throw new HttpError(402, "Daily free-task limit reached for today. Upgrade to continue.");
      }
    }

    const wallet = await resetSubscriptionTokensIfNeeded(user.id);
    if (selectedModel.multiplier > allowedMaxMultiplier) {
      throw new HttpError(
        403,
        `Selected model multiplier (×${selectedModel.multiplier}) exceeds your plan limit (max ×${allowedMaxMultiplier}). Upgrade your subscription to use this model.`
      );
    }

    const tokenCost = estimateChargeWithMultiplier(body.prompt, selectedModel.multiplier);
    const estimatedBaseTokens = estimateTaskCost(body.prompt);

    if (wallet.subscriptionTokensRemaining + wallet.purchasedTokensRemaining < tokenCost) {
      throw new HttpError(402, "Insufficient token balance. Please upgrade or buy a token pack.");
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
      throw new HttpError(400, "No deployed agent is available for this account");
    }

    const risk = classifyRisk(body.prompt);

    const task = await prisma.agentTask.create({
      data: {
        userId: user.id,
        agentId: agent.agentId,
        conversationId: conversation?.id,
        prompt: body.prompt,
        status: risk.isHighRisk ? "PENDING_APPROVAL" : "QUEUED",
        actionType: risk.actionType,
        riskLevel: risk.riskLevel,
        tokenCost: risk.isHighRisk ? 0 : tokenCost,
      },
    });

    if (risk.isHighRisk) {
      const approval = await prisma.approvalRequest.create({
        data: {
          userId: user.id,
          taskId: task.id,
          actionType: risk.actionType,
          payload: JSON.stringify({
            prompt: body.prompt,
            agent: agent.agent.name,
            reason: risk.reason,
            estimatedTokens: tokenCost,
            estimatedBaseTokens,
            billingModelCode: selectedModel.code,
            multiplier: selectedModel.multiplier,
          }),
        },
      });

      await prisma.notification.create({
        data: {
          userId: user.id,
          title: "Approval required",
          body: `${agent.agent.name} needs approval before ${risk.actionType.toLowerCase().replaceAll("_", " ")}.`,
        },
      });

      await writeLog({
        userId: user.id,
        taskId: task.id,
        level: "WARN",
        event: "approval.required",
        summary: risk.reason,
        metadata: { approvalId: approval.id },
      });

      return ok({ status: "PENDING_APPROVAL", task, approval });
    }

    // Run the model call in the background so the HTTP request returns
    // immediately. This keeps us inside any upstream proxy timeout (e.g. the
    // Caddy/Cloudflare 60-100s window) and lets the UI render the queued
    // task right away. The dashboard polls /api/bootstrap and watches the
    // task transition from QUEUED -> RUNNING -> COMPLETED/FAILED.
    void executeTask({ taskId: task.id, billingModelCode: selectedModel.code }).catch((error) => {
      logError("Background task execution failed", error, {
        taskId: task.id,
        userId: user.id,
        billingModelCode: selectedModel.code,
      });
    });

    return ok({ status: "RUNNING", task });
  } catch (error) {
    return fail(error);
  }
}
