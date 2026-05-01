import { requireUser } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getActiveEntitlement, resetSubscriptionTokensIfNeeded } from "@/lib/tokens";

export async function GET() {
  try {
    const user = await requireUser();
    await resetSubscriptionTokensIfNeeded(user.id);

    const [
      entitlement,
      wallet,
      plans,
      tokenPacks,
      agents,
      userAgents,
      conversations,
      tasks,
      approvals,
      notifications,
      transactions,
      logs,
    ] = await Promise.all([
      getActiveEntitlement(user.id),
      prisma.tokenWallet.findUnique({ where: { userId: user.id } }),
      // Marketplace subscription grid should only show the current pricing tiers.
      // Hard-exclude legacy/alternate plan codes that may still exist in the DB.
      prisma.plan.findMany({
        where: {
          isActive: true,
          // Marketplace subscription cards use `plan.name` for display,
          // so we exclude both by code + by name to prevent legacy duplicates.
          code: { notIn: ["basic", "professional"] },
          name: { notIn: ["Basic", "Professional"] },
        },
        orderBy: { monthlyPriceInr: "asc" },
      }),
      // Token Recharge Packs (Growth Pricing): keep only the spec packs.
      prisma.tokenPack.findMany({
        where: {
          isActive: true,
          code: { in: ["lite", "speed", "power", "giga"] },
        },
        orderBy: { priceInr: "asc" },
      }),
      prisma.agent.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
      prisma.userAgent.findMany({ where: { userId: user.id }, include: { agent: true } }),
      prisma.conversation.findMany({
        where: { userId: user.id },
        include: { agent: true, messages: { orderBy: { createdAt: "asc" }, take: 50 } },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
      prisma.agentTask.findMany({
        where: { userId: user.id },
        include: { agent: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.approvalRequest.findMany({
        where: { userId: user.id },
        include: { task: { include: { agent: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.paymentTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.systemLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    ]);

    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      entitlement,
      wallet,
      plans,
      tokenPacks,
      agents,
      userAgents,
      conversations,
      tasks,
      approvals,
      notifications,
      transactions,
      logs,
    });
  } catch (error) {
    return fail(error);
  }
}
