import { prisma } from "@/lib/prisma";
import { writeLog } from "@/lib/logs";

const DEFAULT_STALE_TASK_TIMEOUT_MS = Number(process.env.TASK_STALE_TIMEOUT_MS ?? process.env.TASK_EXECUTION_TIMEOUT_MS ?? "720000");

export async function markStaleInFlightTasks(userId: string, timeoutMs = DEFAULT_STALE_TASK_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 0;

  const cutoff = new Date(Date.now() - timeoutMs);
  const staleTasks = await prisma.agentTask.findMany({
    where: {
      userId,
      status: { in: ["QUEUED", "RUNNING"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, status: true, updatedAt: true },
    take: 25,
  });

  if (staleTasks.length === 0) return 0;

  await prisma.agentTask.updateMany({
    where: { id: { in: staleTasks.map((task) => task.id) }, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "FAILED",
      result: "Task timed out while waiting for the worker. Please retry from the original prompt.",
    },
  });

  await Promise.all(
    staleTasks.map((task) =>
      writeLog({
        userId,
        taskId: task.id,
        level: "ERROR",
        event: "task.worker.timeout",
        summary: `Task was marked failed after worker timeout from ${task.status}.`,
        metadata: { previousStatus: task.status, lastUpdatedAt: task.updatedAt.toISOString(), timeoutMs },
      }),
    ),
  );

  return staleTasks.length;
}
