import crypto from "node:crypto";
import { HttpError } from "@/lib/http";

type CreateOrderInput = {
  amountInr: number;
  receipt: string;
  notes?: Record<string, string>;
};

export async function createRazorpayOrder(input: CreateOrderInput) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return {
      mode: "mock" as const,
      orderId: `mock_order_${Date.now()}`,
      amountPaise: input.amountInr * 100,
      currency: "INR",
    };
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountInr * 100,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Razorpay order failed: ${response.status} ${body}`);
  }

  const order = (await response.json()) as { id: string; amount: number; currency: string };

  return {
    mode: "razorpay" as const,
    orderId: order.id,
    amountPaise: order.amount,
    currency: order.currency,
  };
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    throw new HttpError(400, "Razorpay secret is not configured");
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    throw new HttpError(400, "RAZORPAY_WEBHOOK_SECRET is not configured");
  }

  if (!signature) {
    throw new HttpError(400, "Missing Razorpay webhook signature header");
  }

  const expected = crypto
    .createHmac("sha256", secret)
    // Razorpay requires the RAW webhook request body (no JSON parsing/stringifying).
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signature);

  // timingSafeEqual throws if buffer sizes differ; treat that as invalid signature.
  if (expectedBuf.length !== sigBuf.length) {
    throw new HttpError(400, "Invalid Razorpay webhook signature");
  }

  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}
