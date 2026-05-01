import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { addMonths } from "@/lib/time";
import { writeLog } from "@/lib/logs";

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function estimateTaskCost(prompt: string) {
  const input = estimateTokens(prompt);
  const reservedOutput = Math.max(250, Math.ceil(input * 1.6));
  return input + reservedOutput;
}

export function estimateChargeWithMultiplier(prompt: string, multiplier: number) {
  return Math.max(1, Math.ceil(estimateTaskCost(prompt) * multiplier));
}

export async function getActiveEntitlement(userId: string) {
  const now = new Date();
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      currentPeriodEnd: { gt: now },
    },
    include: { plan: true },
    orderBy: [{ plan: { monthlyPriceInr: "desc" } }, { createdAt: "desc" }],
  });

  if (subscription) {
    return subscription;
  }

  const freePlan = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
  const resetAt = addMonths(now, 1);

  return prisma.subscription.create({
    data: {
      id: `${userId}:free:${now.getTime()}`,
      userId,
      planId: freePlan.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: resetAt,
    },
    include: { plan: true },
  });
}

export async function resetSubscriptionTokensIfNeeded(userId: string) {
  const wallet = await prisma.tokenWallet.findUnique({ where: { userId } });
  const entitlement = await getActiveEntitlement(userId);
  const now = new Date();

  if (!wallet) {
    return prisma.tokenWallet.create({
      data: {
        userId,
        subscriptionTokensRemaining: entitlement.plan.monthlyTokens,
        resetAt: entitlement.currentPeriodEnd,
      },
    });
  }

  if (wallet.resetAt > now) {
    return wallet;
  }

  const nextPeriodEnd = addMonths(now, 1);
  await prisma.subscription.update({
    where: { id: entitlement.id },
    data: {
      currentPeriodStart: now,
      currentPeriodEnd: nextPeriodEnd,
    },
  });

  await prisma.tokenLedger.create({
    data: {
      userId,
      amount: entitlement.plan.monthlyTokens,
      type: "CREDIT",
      source: "SUBSCRIPTION_RESET",
      reason: `${entitlement.plan.name} monthly tokens reset`,
    },
  });

  return prisma.tokenWallet.update({
    where: { userId },
    data: {
      subscriptionTokensRemaining: entitlement.plan.monthlyTokens,
      resetAt: nextPeriodEnd,
    },
  });
}

export async function debitTokens(userId: string, amount: number, reason: string, metadata?: unknown) {
  if (amount <= 0) {
    return;
  }

  await resetSubscriptionTokensIfNeeded(userId);

  await prisma.$transaction(async (tx) => {
    const wallet = await tx.tokenWallet.findUnique({ where: { userId } });

    if (!wallet) {
      throw new HttpError(402, "Token wallet not found");
    }

    const available = wallet.subscriptionTokensRemaining + wallet.purchasedTokensRemaining;

    if (available < amount) {
      throw new HttpError(402, "Insufficient token balance");
    }

    const fromSubscription = Math.min(wallet.subscriptionTokensRemaining, amount);
    const remaining = amount - fromSubscription;

    await tx.tokenWallet.update({
      where: { userId },
      data: {
        subscriptionTokensRemaining: wallet.subscriptionTokensRemaining - fromSubscription,
        purchasedTokensRemaining: wallet.purchasedTokensRemaining - remaining,
      },
    });

    await tx.tokenLedger.create({
      data: {
        userId,
        amount: -amount,
        type: "DEBIT",
        source: "AGENT_TASK",
        reason,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });
  });
}

export async function activatePlan(userId: string, planCode: string) {
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });

  if (!plan || !plan.isActive) {
    throw new HttpError(404, "Plan not found");
  }

  const now = new Date();
  const currentPeriodEnd = addMonths(now, 1);

  await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "CANCELED" },
    });

    await tx.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd,
      },
    });

    await tx.tokenWallet.upsert({
      where: { userId },
      update: {
        subscriptionTokensRemaining: plan.monthlyTokens,
        resetAt: currentPeriodEnd,
      },
      create: {
        userId,
        subscriptionTokensRemaining: plan.monthlyTokens,
        resetAt: currentPeriodEnd,
      },
    });

    await tx.tokenLedger.create({
      data: {
        userId,
        amount: plan.monthlyTokens,
        type: "CREDIT",
        source: "SUBSCRIPTION_ACTIVATION",
        reason: `${plan.name} plan activated`,
      },
    });
  });

  await writeLog({
    userId,
    event: "billing.subscription_activated",
    summary: `${plan.name} plan activated and monthly tokens reset.`,
    metadata: { planCode },
  });

  return plan;
}

export async function grantTokenPack(userId: string, packCode: string) {
  const pack = await prisma.tokenPack.findUnique({ where: { code: packCode } });

  if (!pack || !pack.isActive) {
    throw new HttpError(404, "Token pack not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.tokenWallet.upsert({
      where: { userId },
      update: {
        purchasedTokensRemaining: { increment: pack.tokens },
      },
      create: {
        userId,
        purchasedTokensRemaining: pack.tokens,
        resetAt: addMonths(new Date(), 1),
      },
    });

    await tx.tokenLedger.create({
      data: {
        userId,
        amount: pack.tokens,
        type: "CREDIT",
        source: "TOKEN_PACK",
        reason: `${pack.name} purchased`,
        metadata: JSON.stringify({ packCode }),
      },
    });
  });

  await writeLog({
    userId,
    event: "billing.token_pack_granted",
    summary: `${pack.tokens.toLocaleString("en-IN")} purchased tokens added.`,
    metadata: { packCode },
  });

  return pack;
}
