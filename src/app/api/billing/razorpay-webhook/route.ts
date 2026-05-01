import { z } from "zod";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { activatePlan, grantTokenPack } from "@/lib/tokens";
import { verifyRazorpayWebhookSignature } from "@/lib/payments";

const webhookEnvelopeSchema = z.object({
  event: z.string(),
  payload: z.any(),
});

function extractOrderAndPaymentIds(event: string, payload: any): { orderId: string | null; paymentId: string | null } {
  if (event === "payment.captured") {
    const entity = payload?.payment?.entity;
    return { orderId: entity?.order_id ?? null, paymentId: entity?.id ?? null };
  }

  if (event === "order.paid") {
    const orderEntity = payload?.order?.entity;
    const paymentEntity = payload?.payment?.entity;
    return {
      orderId: orderEntity?.id ?? paymentEntity?.order_id ?? null,
      paymentId: paymentEntity?.id ?? null,
    };
  }

  return { orderId: null, paymentId: null };
}

export async function POST(request: Request) {
  try {
    const signature =
      request.headers.get("x-razorpay-signature") ??
      request.headers.get("X-Razorpay-Signature") ??
      "";

    const rawBody = await request.text();

    // Verify signature BEFORE parsing body (Razorpay requires RAW body).
    verifyRazorpayWebhookSignature(rawBody, signature);

    const parsed = webhookEnvelopeSchema.parse(JSON.parse(rawBody));
    const event = parsed.event;
    const { orderId, paymentId } = extractOrderAndPaymentIds(event, parsed.payload);

    if (!orderId) {
      return ok({ received: true, ignored: "missing_order_id" });
    }

    // Razorpay webhooks are server-to-server; no user session cookie here.
    // We identify the user via the stored PaymentTransaction.
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { razorpayOrderId: orderId },
    });

    if (!transaction) {
      return ok({ received: true, ignored: "unknown_transaction" });
    }

    if (transaction.status === "CAPTURED") {
      return ok({ received: true, ignored: "already_captured" });
    }

    const metadata = transaction.metadata ? JSON.parse(transaction.metadata) : {};

    // Grant entitlements first; then mark the transaction as captured.
    if (transaction.kind === "SUBSCRIPTION") {
      if (!metadata.planCode || typeof metadata.planCode !== "string") {
        throw new HttpError(400, "Missing subscription planCode in transaction metadata");
      }
      await activatePlan(transaction.userId, metadata.planCode);
    } else {
      if (!metadata.packCode || typeof metadata.packCode !== "string") {
        throw new HttpError(400, "Missing token packCode in transaction metadata");
      }
      await grantTokenPack(transaction.userId, metadata.packCode);
    }

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "CAPTURED",
        razorpayPaymentId: paymentId ?? null,
      },
    });

    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}

