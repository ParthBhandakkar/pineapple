import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { verifyRazorpaySignature } from "@/lib/payments";
import { activatePlan, grantTokenPack } from "@/lib/tokens";

const verifySchema = z.object({
  transactionId: z.string(),
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = verifySchema.parse(await request.json());
    const transaction = await prisma.paymentTransaction.findFirst({
      where: {
        id: body.transactionId,
        userId: user.id,
        razorpayOrderId: body.razorpay_order_id,
      },
    });

    if (!transaction) {
      throw new HttpError(404, "Transaction not found");
    }

    // Idempotency: if webhook already processed this transaction, avoid granting twice.
    if (transaction.status === "CAPTURED") {
      return ok({ success: true });
    }

    if (!verifyRazorpaySignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
      throw new HttpError(400, "Invalid Razorpay signature");
    }

    const metadata = transaction.metadata ? JSON.parse(transaction.metadata) : {};

    if (transaction.kind === "SUBSCRIPTION") {
      await activatePlan(user.id, metadata.planCode);
    } else {
      await grantTokenPack(user.id, metadata.packCode);
    }

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "CAPTURED",
        razorpayPaymentId: body.razorpay_payment_id,
      },
    });

    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
