import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { executeTask } from "@/lib/execution";
import { writeLog } from "@/lib/logs";
import { getAllowedMaxMultiplier, getBillingModel } from "@/lib/models";
import { getActiveEntitlement } from "@/lib/tokens";
import { logError } from "@/lib/error-logger";

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = decisionSchema.parse(await request.json());
    const approval = await prisma.approvalRequest.findFirst({
      where: { id, userId: user.id },
      include: { task: true },
    });

    if (!approval) {
      throw new HttpError(404, "Approval request not found");
    }

    if (approval.status !== "PENDING") {
      throw new HttpError(409, "This approval request was already decided");
    }

    if (body.decision === "REJECTED") {
      await prisma.$transaction([
        prisma.approvalRequest.update({
          where: { id: approval.id },
          data: { status: "REJECTED", decidedAt: new Date() },
        }),
        prisma.agentTask.update({
          where: { id: approval.taskId },
          data: { status: "REJECTED" },
        }),
        prisma.notification.create({
          data: {
            userId: user.id,
            title: "Request rejected",
            body: "The sensitive agent action was cancelled.",
          },
        }),
      ]);

      await writeLog({
        userId: user.id,
        taskId: approval.taskId,
        level: "WARN",
        event: "approval.rejected",
        summary: "User rejected a high-risk action.",
      });

      return ok({ status: "REJECTED" });
    }

    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { status: "APPROVED", decidedAt: new Date() },
    });

    await writeLog({
      userId: user.id,
      taskId: approval.taskId,
      event: "approval.approved",
      summary: "User approved a high-risk action for execution.",
    });

    const requestPayload = (() => {
      try {
        return JSON.parse(approval.payload) as { billingModelCode?: string };
      } catch (error) {
        logError("Failed to parse approval payload", error, {
          approvalId: approval.id,
          userId: user.id,
        });
        return {} as { billingModelCode?: string };
      }
    })();

    const entitlement = await getActiveEntitlement(user.id);
    const selectedModel = getBillingModel(requestPayload.billingModelCode);
    const allowedMaxMultiplier = getAllowedMaxMultiplier(entitlement.plan.code);

    if (selectedModel.multiplier > allowedMaxMultiplier) {
      throw new HttpError(
        403,
        `Selected model multiplier (×${selectedModel.multiplier}) exceeds your plan limit (max ×${allowedMaxMultiplier}).`
      );
    }

    const task = await executeTask({
      taskId: approval.taskId,
      approved: true,
      billingModelCode: requestPayload.billingModelCode,
    });

    return ok({ status: "APPROVED", task });
  } catch (error) {
    return fail(error);
  }
}
