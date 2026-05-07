import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { executeTask } from "@/lib/execution";
import { logError } from "@/lib/error-logger";
import { getBillingModel } from "@/lib/models";

export const maxDuration = 60;

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
    if (task.status !== "FAILED") throw new HttpError(400, "Only failed tasks can be retried");

    const selectedModel = getBillingModel(body.modelCode);

    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "QUEUED", result: null, tokenCost: 0 },
    });

    if (task.conversationId) {
      await prisma.message.deleteMany({
        where: {
          conversationId: task.conversationId,
          role: "ASSISTANT",
          content: task.result ?? "__never_match__",
        },
      });
    }

    void executeTask({ taskId: task.id, billingModelCode: selectedModel.code }).catch((error) => {
      logError("Retry task execution failed", error, {
        taskId: task.id,
        userId: user.id,
        billingModelCode: selectedModel.code,
      });
    });

    return ok({ status: "RUNNING", taskId: task.id });
  } catch (error) {
    return fail(error);
  }
}
