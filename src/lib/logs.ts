import { prisma } from "@/lib/prisma";

type LogInput = {
  userId?: string;
  taskId?: string;
  level?: "INFO" | "WARN" | "ERROR" | "AUDIT";
  event: string;
  summary: string;
  metadata?: unknown;
};

export async function writeLog(input: LogInput) {
  await prisma.systemLog.create({
    data: {
      userId: input.userId,
      taskId: input.taskId,
      level: input.level ?? "INFO",
      event: input.event,
      summary: input.summary,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  });
}
