import { getOpenCodeHealth } from "@/lib/opencode";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/error-logger";

export async function GET() {
  let opencode: { healthy: boolean; version: string } | null = null;
  let database: { healthy: boolean } = { healthy: false };

  try {
    opencode = await getOpenCodeHealth();
  } catch (error) {
    logError("OpenCode health probe failed", error);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { healthy: true };
  } catch (error) {
    logError("Database health probe failed", error);
  }

  return ok({
    status: "ok",
    service: "agentsim",
    database,
    opencode,
    timestamp: new Date().toISOString(),
  });
}
