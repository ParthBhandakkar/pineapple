import { getOpenCodeHealth } from "@/lib/opencode";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/error-logger";

export async function GET() {
  let opencode: { healthy: boolean; version: string } | null = null;
  let database: { healthy: boolean } = { healthy: false };
  const requiresOpenCode = true;
  let modelProvider: { healthy: boolean; status?: number; detail?: string } | null = null;

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

  try {
    if (!opencode) {
      modelProvider = { healthy: false, detail: "OpenCode health not yet available" };
    } else if (!opencode.healthy) {
      modelProvider = { healthy: false, detail: "OpenCode reported unhealthy status" };
    } else {
      modelProvider = { healthy: true };
    }
  } catch (error) {
    logError("Model provider health probe failed", error);
    modelProvider = { healthy: false, detail: "Model provider probe failed" };
  }

  const opencodeHealthy = Boolean(opencode?.healthy);
  const overallHealthy = database.healthy && opencodeHealthy && Boolean(modelProvider?.healthy);

  return ok(
    {
      status: overallHealthy ? "ok" : "degraded",
      service: "agentsim",
      database,
      opencode,
      modelProvider,
      requiresOpenCode,
      timestamp: new Date().toISOString(),
    },
    { status: overallHealthy ? 200 : 503 },
  );
}
