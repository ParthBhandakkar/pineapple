import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { activatePlan, grantTokenPack } from "@/lib/tokens";

const mockCompleteSchema = z.object({
  transactionId: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = mockCompleteSchema.parse(await request.json());
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { id: body.transactionId, userId: user.id },
    });

    if (!transaction) {
      throw new HttpError(404, "Transaction not found");
    }

    if (transaction.status !== "CREATED") {
      throw new HttpError(409, "Transaction has already been processed");
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
        razorpayPaymentId: `mock_payment_${Date.now()}`,
      },
    });

    await prisma.notification.create({
      data: {
        userId: user.id,
        title: "Payment completed",
        body: "Mock payment completed successfully. Add Razorpay keys for live checkout.",
      },
    });

    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
