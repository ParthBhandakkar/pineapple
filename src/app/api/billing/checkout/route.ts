import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createRazorpayOrder } from "@/lib/payments";
import { activatePlan } from "@/lib/tokens";

const checkoutSchema = z.object({
  kind: z.enum(["SUBSCRIPTION", "TOKEN_PACK"]),
  planCode: z.string().optional(),
  packCode: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = checkoutSchema.parse(await request.json());

    const item =
      body.kind === "SUBSCRIPTION"
        ? await prisma.plan.findUnique({ where: { code: body.planCode ?? "" } })
        : await prisma.tokenPack.findUnique({ where: { code: body.packCode ?? "" } });

    if (!item || !("isActive" in item) || !item.isActive) {
      throw new HttpError(404, "Billing item not found");
    }

    const amountInr = "monthlyPriceInr" in item ? item.monthlyPriceInr : item.priceInr;

    if ("isCustom" in item && item.isCustom) {
      throw new HttpError(400, "Enterprise plans are handled by sales");
    }

    if (body.kind === "SUBSCRIPTION" && body.planCode === "free") {
      await activatePlan(user.id, "free");
      return ok({ mode: "activated", message: "Free plan activated" });
    }

    const transaction = await prisma.paymentTransaction.create({
      data: {
        userId: user.id,
        amountInr,
        kind: body.kind,
        status: "CREATED",
        metadata: JSON.stringify(body),
      },
    });

    const order = await createRazorpayOrder({
      amountInr,
      receipt: transaction.id,
      notes: {
        transactionId: transaction.id,
        userId: user.id,
        kind: body.kind,
      },
    });

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: { razorpayOrderId: order.orderId },
    });

    return ok({
      mode: order.mode,
      transactionId: transaction.id,
      orderId: order.orderId,
      amountPaise: order.amountPaise,
      amountInr,
      currency: order.currency,
      // `NEXT_PUBLIC_RAZORPAY_KEY_ID` is expected to be used in the browser, but it may be
      // set to an empty string. Treat empty string as missing so Razorpay can still open.
      keyId:
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() ||
        process.env.RAZORPAY_KEY_ID?.trim() ||
        "",
    });
  } catch (error) {
    return fail(error);
  }
}
