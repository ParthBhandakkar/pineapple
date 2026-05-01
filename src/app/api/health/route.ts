import { getOpenCodeHealth } from "@/lib/opencode";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/error-logger";
import { fetchWithModelTimeout } from "@/lib/fetch-timeout";

export async function GET() {
  let opencode: { healthy: boolean; version: string } | null = null;
  let database: { healthy: boolean } = { healthy: false };
  const requiresOpenCode = process.env.FORCE_OPENCODE_ONLY === "true";
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
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) {
      modelProvider = { healthy: false, detail: "OPENROUTER_API_KEY is not configured" };
    } else {
      const response = await fetchWithModelTimeout(
        "https://openrouter.ai/api/v1/models",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
            "X-Title": process.env.OPENROUTER_APP_NAME || "PineApple",
          },
          cache: "no-store",
        },
        15_000,
      );
      modelProvider = {
        healthy: response.ok,
        status: response.status,
        detail: response.ok ? undefined : (await response.text()).slice(0, 240),
      };
    }
  } catch (error) {
    logError("Model provider health probe failed", error);
    modelProvider = { healthy: false, detail: "OpenRouter probe failed" };
  }

  const opencodeHealthy = requiresOpenCode ? Boolean(opencode?.healthy) : true;
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
