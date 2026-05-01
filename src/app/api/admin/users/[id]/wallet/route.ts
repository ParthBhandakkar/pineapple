import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeLog } from "@/lib/logs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const adjustSchema = z.object({
  subscriptionDelta: z.number().int().optional(),
  purchasedDelta: z.number().int().optional(),
  reason: z.string().min(1).max(240),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const body = adjustSchema.parse(await request.json());

    const wallet = await prisma.tokenWallet.findUnique({ where: { userId: id } });
    if (!wallet) throw new HttpError(404, "User wallet not found");

    const subDelta = body.subscriptionDelta ?? 0;
    const purDelta = body.purchasedDelta ?? 0;

    const nextSub = Math.max(0, wallet.subscriptionTokensRemaining + subDelta);
    const nextPur = Math.max(0, wallet.purchasedTokensRemaining + purDelta);

    const updated = await prisma.tokenWallet.update({
      where: { userId: id },
      data: {
        subscriptionTokensRemaining: nextSub,
        purchasedTokensRemaining: nextPur,
      },
    });

    if (subDelta !== 0) {
      await prisma.tokenLedger.create({
        data: {
          userId: id,
          amount: subDelta,
          type: subDelta > 0 ? "CREDIT" : "DEBIT",
          source: "ADMIN_ADJUSTMENT",
          reason: body.reason,
        },
      });
    }
    if (purDelta !== 0) {
      await prisma.tokenLedger.create({
        data: {
          userId: id,
          amount: purDelta,
          type: purDelta > 0 ? "CREDIT" : "DEBIT",
          source: "ADMIN_ADJUSTMENT",
          reason: body.reason,
        },
      });
    }

    await writeLog({
      userId: admin.id,
      level: "AUDIT",
      event: "admin.wallet.adjusted",
      summary: `Admin ${admin.email} adjusted wallet for user ${id} (sub:${subDelta}, pur:${purDelta}).`,
      metadata: { reason: body.reason, subDelta, purDelta },
    });

    return ok({ wallet: updated });
  } catch (error) {
    return fail(error);
  }
}
