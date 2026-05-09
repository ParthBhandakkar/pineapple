import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { executeTask } from "@/lib/execution";
import { logError } from "@/lib/error-logger";
import { getAllowedMaxMultiplier, getBillingModel } from "@/lib/models";
import { estimateChargeWithMultiplier, getActiveEntitlement } from "@/lib/tokens";
import { isTestingUnlimited } from "@/lib/testing-unlimited";

export const maxDuration = 60;

const inFlightStatuses = new Set(["QUEUED", "RUNNING"]);

const retrySchema = z.object({
  taskId: z.string().min(1),
  modelCode: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = retrySchema.parse(await request.json());

    const task = await prisma.agentTask.findFirst({
      where: { id: body.taskId, userId: user.id },
    });

    if (!task) throw new HttpError(404, "Task not found");
    if (task.status === "PENDING_APPROVAL") {
      throw new HttpError(400, "Approve or reject this task before retrying it");
    }

    const selectedModel = getBillingModel(body.modelCode);
    const entitlement = await getActiveEntitlement(user.id);
    const allowedMaxMultiplier = isTestingUnlimited() ? Number.POSITIVE_INFINITY : getAllowedMaxMultiplier(entitlement.plan.code);
    if (selectedModel.multiplier > allowedMaxMultiplier) {
      throw new HttpError(
        403,
        `Selected model multiplier (×${selectedModel.multiplier}) exceeds your plan limit (max ×${allowedMaxMultiplier}).`
      );
    }

    if (inFlightStatuses.has(task.status)) {
      await prisma.agentTask.updateMany({
        where: { id: task.id, userId: user.id, status: { in: [...inFlightStatuses] } },
        data: {
          status: "FAILED",
          result: "Restarted by user. A fresh run was queued from the original prompt.",
        },
      });
    }

    const retryTask = await prisma.agentTask.create({
      data: {
        userId: user.id,
        agentId: task.agentId ?? null,
        conversationId: task.conversationId ?? null,
        prompt: task.prompt,
        status: "QUEUED",
        actionType: task.actionType,
        riskLevel: task.riskLevel,
        result: null,
        tokenCost: 0,
      },
    });

    void executeTask({ taskId: retryTask.id, billingModelCode: selectedModel.code }).catch((error) => {
      logError("Retry task execution failed", error, {
        taskId: retryTask.id,
        userId: user.id,
        billingModelCode: selectedModel.code,
      });
    });

    if (!isTestingUnlimited()) {
      const estimatedTaskCost = estimateChargeWithMultiplier(task.prompt, selectedModel.multiplier);
      await prisma.agentTask.update({
        where: { id: retryTask.id },
        data: { tokenCost: estimatedTaskCost },
      });
    }

    return ok({ status: "RUNNING", taskId: retryTask.id, task: retryTask });
  } catch (error) {
    return fail(error);
  }
}
