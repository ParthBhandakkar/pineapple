import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  status: z.enum(["ALL", "CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"]).optional(),
  kind: z.enum(["ALL", "SUBSCRIPTION", "TOKEN_PACK"]).optional(),
  userId: z.string().optional(),
  search: z.string().optional(),
  take: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const params = querySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
    });

    const where: Record<string, unknown> = {};
    if (params.status && params.status !== "ALL") where.status = params.status;
    if (params.kind && params.kind !== "ALL") where.kind = params.kind;
    if (params.userId) where.userId = params.userId;
    if (params.search) {
      where.OR = [
        { razorpayOrderId: { contains: params.search, mode: "insensitive" } },
        { razorpayPaymentId: { contains: params.search, mode: "insensitive" } },
        { id: { contains: params.search, mode: "insensitive" } },
        { user: { email: { contains: params.search, mode: "insensitive" } } },
      ];
    }

    const transactions = await prisma.paymentTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.take ?? 100,
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const totals = await prisma.paymentTransaction.groupBy({
      by: ["status"],
      _sum: { amountInr: true },
      _count: { _all: true },
    });

    return ok({ transactions, totals });
  } catch (error) {
    return fail(error);
  }
}
