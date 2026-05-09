import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeLog } from "@/lib/logs";

const cancelSchema = z.object({
  taskId: z.string().min(1),
});

const cancellableStatuses = ["QUEUED", "RUNNING"];

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = cancelSchema.parse(await request.json());

    const task = await prisma.agentTask.findFirst({
      where: { id: body.taskId, userId: user.id },
    });

    if (!task) throw new HttpError(404, "Task not found");
    if (!cancellableStatuses.includes(task.status)) {
      throw new HttpError(400, "Only queued or running tasks can be cancelled");
    }

    const updated = await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        result: "Cancelled by user before completion.",
      },
    });

    await writeLog({
      userId: user.id,
      taskId: task.id,
      level: "WARN",
      event: "task.cancelled",
      summary: "User cancelled an in-flight task.",
      metadata: { previousStatus: task.status },
    });

    return ok({ cancelled: true, task: updated });
  } catch (error) {
    return fail(error);
  }
}
