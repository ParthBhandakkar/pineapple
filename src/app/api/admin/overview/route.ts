import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  planId: z.string().optional(),
  packId: z.string().optional(),
  name: z.string().min(1).max(120).optional(),
  tagline: z.string().max(160).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  monthlyPriceInr: z.number().int().min(0).optional(),
  monthlyTokens: z.number().int().min(0).optional(),
  maxAgents: z.number().int().min(1).optional(),
  priceInr: z.number().int().min(0).optional(),
  tokens: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireAdmin();

    const [users, activeSubscriptions, revenue, taskCounts, plans, tokenPacks, logs] = await Promise.all([
      prisma.user.count(),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.paymentTransaction.aggregate({
        where: { status: "CAPTURED" },
        _sum: { amountInr: true },
      }),
      prisma.agentTask.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
      prisma.plan.findMany({ orderBy: { monthlyPriceInr: "asc" } }),
      prisma.tokenPack.findMany({ orderBy: { priceInr: "asc" } }),
      prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: 80, include: { user: true } }),
    ]);

    return ok({
      metrics: {
        users,
        activeSubscriptions,
        revenueInr: revenue._sum.amountInr ?? 0,
        taskCounts,
      },
      plans,
      tokenPacks,
      logs,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = patchSchema.parse(await request.json());

    if (body.packId) {
      const tokenPack = await prisma.tokenPack.update({
        where: { id: body.packId },
        data: {
          name: body.name,
          tokens: body.tokens,
          priceInr: body.priceInr,
          isActive: body.isActive,
        },
      });

      return ok({ tokenPack });
    }

    if (!body.planId) {
      throw new HttpError(400, "Either planId or packId is required");
    }

    const plan = await prisma.plan.update({
      where: { id: body.planId },
      data: {
        name: body.name,
        tagline: body.tagline ?? undefined,
        description: body.description ?? undefined,
        monthlyPriceInr: body.monthlyPriceInr,
        monthlyTokens: body.monthlyTokens,
        maxAgents: body.maxAgents,
        isActive: body.isActive,
      },
    });

    return ok({ plan });
  } catch (error) {
    return fail(error);
  }
}
