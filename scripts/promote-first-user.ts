/**
 * Promotes the earliest-registered, non-seed real user to ADMIN.
 *
 * Behaviour:
 * - Skips the seed accounts (admin@agentsim.local, demo@agentsim.local) so we
 *   target actual humans who registered through the UI.
 * - If only seed accounts exist, falls back to keeping the existing seed admin.
 * - Idempotent: if there's already a non-seed ADMIN, it does nothing.
 */
import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";

try {
  loadEnvFile(".env.production");
} catch {
  /* noop */
}
try {
  loadEnvFile(".env");
} catch {
  /* noop */
}

const SEED_EMAILS = new Set([
  (process.env.SEED_ADMIN_EMAIL ?? "admin@agentsim.local").toLowerCase(),
  (process.env.SEED_USER_EMAIL ?? "demo@agentsim.local").toLowerCase(),
]);

async function main() {
  const prisma = new PrismaClient();
  try {
    const realAdmin = await prisma.user.findFirst({
      where: {
        role: "ADMIN",
        email: { notIn: Array.from(SEED_EMAILS) },
      },
      orderBy: { createdAt: "asc" },
    });

    if (realAdmin) {
      console.log(`[promote] Real admin already exists: ${realAdmin.email}`);
      return;
    }

    const firstReal = await prisma.user.findFirst({
      where: { email: { notIn: Array.from(SEED_EMAILS) } },
      orderBy: { createdAt: "asc" },
    });

    if (!firstReal) {
      console.log("[promote] No real (non-seed) users found yet. Skipping.");
      return;
    }

    const updated = await prisma.user.update({
      where: { id: firstReal.id },
      data: { role: "ADMIN" },
    });

    console.log(`[promote] Promoted first real user to ADMIN: ${updated.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[promote] Failed:", error);
  process.exit(1);
});
