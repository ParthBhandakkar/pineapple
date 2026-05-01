import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getActiveEntitlement } from "@/lib/tokens";
import { writeLog } from "@/lib/logs";

const deploySchema = z.object({
  agentIds: z.array(z.string()).min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = deploySchema.parse(await request.json());
    const uniqueAgentIds = [...new Set(body.agentIds)];
    const entitlement = await getActiveEntitlement(user.id);
    const agents = await prisma.agent.findMany({ where: { id: { in: uniqueAgentIds }, isActive: true } });

    if (agents.length !== uniqueAgentIds.length) {
      throw new HttpError(400, "One or more selected agents are unavailable");
    }

    if (entitlement.plan.code === "free" && agents.some((agent) => !agent.isDefault)) {
      throw new HttpError(402, "Please activate a subscription to deploy marketplace agents");
    }

    const existing = await prisma.userAgent.findMany({
      where: { userId: user.id, agentId: { in: uniqueAgentIds }, status: "DEPLOYED" },
      select: { agentId: true },
    });
    const existingIds = new Set(existing.map((item) => item.agentId));
    const newAgentIds = uniqueAgentIds.filter((agentId) => !existingIds.has(agentId));
    const deployedCount = await prisma.userAgent.count({ where: { userId: user.id, status: "DEPLOYED" } });

    if (newAgentIds.length === 0) {
      throw new HttpError(409, "Selected agents are already deployed");
    }

    if (deployedCount + newAgentIds.length > entitlement.plan.maxAgents) {
      throw new HttpError(400, `Your plan allows ${entitlement.plan.maxAgents} deployed agent(s)`);
    }

    await prisma.$transaction(
      newAgentIds.map((agentId) =>
        prisma.userAgent.upsert({
          where: { userId_agentId: { userId: user.id, agentId } },
          update: { status: "DEPLOYED", deployedAt: new Date() },
          create: { userId: user.id, agentId, status: "DEPLOYED", deployedAt: new Date() },
        }),
      ),
    );

    await prisma.notification.create({
      data: {
        userId: user.id,
        title: "Agents safely deployed",
        body: `${agents.filter((agent) => newAgentIds.includes(agent.id)).map((agent) => agent.name).join(", ")} are now available in chat.`,
        surface: "marketplace",
        kind: "success",
      },
    });

    await writeLog({
      userId: user.id,
      event: "agents.deployed",
      summary: `${newAgentIds.length} agent(s) deployed.`,
      metadata: { agentIds: newAgentIds },
    });

    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
