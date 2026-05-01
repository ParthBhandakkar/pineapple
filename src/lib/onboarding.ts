import { prisma } from "@/lib/prisma";
import { addMonths } from "@/lib/time";
import { writeLog } from "@/lib/logs";

export async function provisionNewUser(userId: string) {
  const now = new Date();
  const freePlan = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
  const defaultAgent = await prisma.agent.findFirstOrThrow({ where: { isDefault: true } });
  const resetAt = addMonths(now, 1);

  await prisma.$transaction(async (tx) => {
    await tx.subscription.create({
      data: {
        userId,
        planId: freePlan.id,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: resetAt,
      },
    });

    await tx.tokenWallet.create({
      data: {
        userId,
        subscriptionTokensRemaining: freePlan.monthlyTokens,
        resetAt,
      },
    });

    await tx.userAgent.create({
      data: {
        userId,
        agentId: defaultAgent.id,
        status: "DEPLOYED",
        deployedAt: now,
      },
    });

    await tx.notification.create({
      data: {
        userId,
        title: "Free tier activated",
        body: `${freePlan.monthlyTokens.toLocaleString("en-IN")} monthly tokens and Code Pilot are ready.`,
      },
    });
  });

  await writeLog({
    userId,
    event: "user.provisioned",
    summary: "Free tier, token wallet, and default agent were provisioned.",
  });
}
