import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  search: z.string().optional(),
  role: z.enum(["ALL", "USER", "ADMIN"]).optional(),
  status: z.enum(["ALL", "ACTIVE", "SUSPENDED"]).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const params = querySchema.parse({
      search: url.searchParams.get("search") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
    });

    const where: Record<string, unknown> = {};
    if (params.search) {
      where.OR = [
        { email: { contains: params.search, mode: "insensitive" } },
        { name: { contains: params.search, mode: "insensitive" } },
      ];
    }
    if (params.role && params.role !== "ALL") where.role = params.role;
    if (params.status && params.status !== "ALL") where.status = params.status;

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.take ?? 100,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        wallet: {
          select: {
            subscriptionTokensRemaining: true,
            purchasedTokensRemaining: true,
          },
        },
        subscriptions: {
          where: { status: "ACTIVE" },
          take: 1,
          orderBy: { currentPeriodEnd: "desc" },
          select: { plan: { select: { code: true, name: true } } },
        },
        _count: {
          select: {
            tasks: true,
            conversations: true,
            transactions: true,
          },
        },
      },
    });

    return ok({ users });
  } catch (error) {
    return fail(error);
  }
}
