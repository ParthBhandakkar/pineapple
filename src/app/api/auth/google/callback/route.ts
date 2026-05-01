import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword } from "@/lib/auth";
import { addMonths } from "@/lib/time";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
};

type GoogleProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
};

async function ensureFreeWorkspace(userId: string) {
  const freePlan = await prisma.plan.findUnique({ where: { code: "free" } });
  const defaultAgent = await prisma.agent.findFirst({ where: { isDefault: true, isActive: true } });
  const now = new Date();
  const resetAt = addMonths(now, 1);

  if (freePlan) {
    await prisma.subscription.upsert({
      where: { id: `${userId}:free` },
      update: {
        planId: freePlan.id,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: resetAt,
      },
      create: {
        id: `${userId}:free`,
        userId,
        planId: freePlan.id,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: resetAt,
      },
    });

    await prisma.tokenWallet.upsert({
      where: { userId },
      update: {
        subscriptionTokensRemaining: freePlan.monthlyTokens,
        resetAt,
      },
      create: {
        userId,
        subscriptionTokensRemaining: freePlan.monthlyTokens,
        resetAt,
      },
    });
  }

  if (defaultAgent) {
    await prisma.userAgent.upsert({
      where: { userId_agentId: { userId, agentId: defaultAgent.id } },
      update: { status: "DEPLOYED", deployedAt: now },
      create: { userId, agentId: defaultAgent.id, status: "DEPLOYED", deployedAt: now },
    });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/auth/google/callback`;

  if (!code || !clientId || !clientSecret) {
    redirect("/?auth_error=google_not_configured");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = (await tokenResponse.json()) as GoogleTokenResponse;

  if (!tokenResponse.ok || !tokenBody.access_token) {
    redirect("/?auth_error=google_failed");
  }

  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const profile = (await profileResponse.json()) as GoogleProfile;

  if (!profileResponse.ok || !profile.email || !profile.sub || profile.email_verified === false) {
    redirect("/?auth_error=google_failed");
  }

  const existing =
    (await prisma.user.findUnique({ where: { googleId: profile.sub } })) ??
    (await prisma.user.findUnique({ where: { email: profile.email.toLowerCase() } }));

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { googleId: existing.googleId ?? profile.sub, name: existing.name || profile.name || profile.email },
      })
    : await prisma.user.create({
        data: {
          googleId: profile.sub,
          email: profile.email.toLowerCase(),
          name: profile.name || profile.email.split("@")[0],
          passwordHash: await hashPassword(crypto.randomUUID()),
        },
      });

  await ensureFreeWorkspace(user.id);
  await createSession(user.id);

  redirect("/dashboard");
}
