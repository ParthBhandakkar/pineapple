import { loadEnvFile } from "node:process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

try {
  loadEnvFile(".env");
} catch {
  // The seed can still run in environments that inject variables directly.
}

const prisma = new PrismaClient();

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

async function seedPlans() {
  const plans = [
    {
      code: "free",
      name: "Free",
      monthlyPriceInr: 0,
      monthlyTokens: 25000,
      maxAgents: 1,
      isCustom: false,
    },
    {
      code: "starter",
      name: "Starter",
      monthlyPriceInr: 799,
      monthlyTokens: 600000,
      maxAgents: 4,
      isCustom: false,
    },
    {
      code: "basic",
      name: "Basic",
      monthlyPriceInr: 4999,
      monthlyTokens: 6000000,
      maxAgents: 20,
      isCustom: false,
      // Disable legacy/duplicate tier so Marketplace doesn't render extra cards.
      isActive: false,
    },
    {
      code: "silver",
      name: "Silver",
      monthlyPriceInr: 1999,
      monthlyTokens: 2500000,
      maxAgents: 7,
      isCustom: false,
    },
    {
      code: "professional",
      name: "Professional",
      monthlyPriceInr: 1999,
      monthlyTokens: 2500000,
      maxAgents: 7,
      isCustom: false,
      // Disable legacy/duplicate tier so Marketplace doesn't render extra cards.
      isActive: false,
    },
    {
      code: "pro",
      name: "Pro",
      monthlyPriceInr: 4999,
      monthlyTokens: 6000000,
      maxAgents: 20,
      isCustom: false,
    },
    {
      code: "business",
      name: "Business",
      monthlyPriceInr: 0,
      monthlyTokens: 10000000,
      maxAgents: 999,
      isCustom: true,
    },
    {
      code: "enterprise",
      name: "Enterprise (Custom)",
      monthlyPriceInr: 0,
      // UI expects a comparable token bucket even for custom plans.
      monthlyTokens: 10000000,
      maxAgents: 999,
      isCustom: true,
      // Disable legacy/duplicate tier.
      isActive: false,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }
}

async function seedTokenPacks() {
  const packs = [
    { code: "lite", name: "Lite", tokens: 100000, priceInr: 99 },
    { code: "speed", name: "Speed", tokens: 300000, priceInr: 249 },
    { code: "power", name: "Power", tokens: 1000000, priceInr: 749 },
    { code: "giga", name: "Giga", tokens: 4000000, priceInr: 2499 },
  ];

  for (const pack of packs) {
    await prisma.tokenPack.upsert({
      where: { code: pack.code },
      update: pack,
      create: pack,
    });
  }
}

async function seedAgents() {
  const agents = [
    {
      slug: "code-pilot",
      name: "Code Pilot",
      category: "Engineering",
      description: "Default OpenCode agent for coding, debugging, refactoring, and technical planning.",
      riskLevel: "MEDIUM",
      isDefault: true,
    },
    {
      slug: "qa-sentinel",
      name: "QA Sentinel",
      category: "Quality",
      description: "Reviews changes, writes test plans, and catches regressions before deployment.",
      riskLevel: "LOW",
      isDefault: false,
    },
    {
      slug: "deploymate",
      name: "DeployMate",
      category: "DevOps",
      description: "Prepares deployment checklists, server actions, release notes, and rollback plans.",
      riskLevel: "HIGH",
      isDefault: false,
    },
    {
      slug: "data-scout",
      name: "Data Scout",
      category: "Research",
      description: "Finds, summarizes, and structures research into decision-ready briefs.",
      riskLevel: "LOW",
      isDefault: false,
    },
    {
      slug: "docs-smith",
      name: "Docs Smith",
      category: "Documentation",
      description: "Creates product docs, API references, onboarding material, and release guides.",
      riskLevel: "LOW",
      isDefault: false,
    },
    {
      slug: "security-gatekeeper",
      name: "Security Gatekeeper",
      category: "Security",
      description: "Classifies risky requests, reviews secrets exposure, and drafts approval gates.",
      riskLevel: "HIGH",
      isDefault: false,
    },
    {
      slug: "growth-analyst",
      name: "Growth Analyst",
      category: "Business",
      description: "Turns product usage, subscriptions, and customer notes into growth insights.",
      riskLevel: "LOW",
      isDefault: false,
    },
    {
      slug: "support-copilot",
      name: "Support Copilot",
      category: "Operations",
      description: "Drafts customer replies, organizes issue queues, and creates resolution summaries.",
      riskLevel: "MEDIUM",
      isDefault: false,
    },
  ];

  for (const agent of agents) {
    await prisma.agent.upsert({
      where: { slug: agent.slug },
      update: agent,
      create: agent,
    });
  }
}

async function createSeedUser(email: string, password: string, name: string, role: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { email, name, role, passwordHash },
  });

  const freePlan = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
  const now = new Date();
  const resetAt = addMonths(now, 1);

  await prisma.subscription.upsert({
    where: { id: `${user.id}:free` },
    update: {
      planId: freePlan.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: resetAt,
    },
    create: {
      id: `${user.id}:free`,
      userId: user.id,
      planId: freePlan.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: resetAt,
    },
  });

  await prisma.tokenWallet.upsert({
    where: { userId: user.id },
    update: {
      subscriptionTokensRemaining: freePlan.monthlyTokens,
      resetAt,
    },
    create: {
      userId: user.id,
      subscriptionTokensRemaining: freePlan.monthlyTokens,
      resetAt,
    },
  });

  const defaultAgent = await prisma.agent.findFirstOrThrow({ where: { isDefault: true } });
  await prisma.userAgent.upsert({
    where: { userId_agentId: { userId: user.id, agentId: defaultAgent.id } },
    update: {
      status: "DEPLOYED",
      deployedAt: now,
    },
    create: {
      userId: user.id,
      agentId: defaultAgent.id,
      status: "DEPLOYED",
      deployedAt: now,
    },
  });

  await prisma.systemLog.create({
    data: {
      userId: user.id,
      event: "seed.user_ready",
      summary: `${name} seed account is ready with the free plan and default agent.`,
    },
  });
}

async function main() {
  await seedPlans();
  await seedTokenPacks();
  await seedAgents();

  await prisma.systemSetting.upsert({
    where: { key: "free_tier_mode" },
    update: { value: "token_count" },
    create: { key: "free_tier_mode", value: "token_count" },
  });

  await createSeedUser(
    process.env.SEED_ADMIN_EMAIL ?? "admin@agentsim.local",
    process.env.SEED_ADMIN_PASSWORD ?? "admin123",
    "AgentSim Admin",
    "ADMIN",
  );

  await createSeedUser(
    process.env.SEED_USER_EMAIL ?? "demo@agentsim.local",
    process.env.SEED_USER_PASSWORD ?? "demo123",
    "Demo Builder",
    "USER",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
