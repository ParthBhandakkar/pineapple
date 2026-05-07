/**
 * When true (e.g. TESTING_UNLIMITED=true in .env / .env.production), billing
 * guardrails are relaxed for private test deployments: no daily task cap, no
 * token balance checks or debits, any model tier, relaxed deploy limits.
 * Must stay false in real production.
 */
export function isTestingUnlimited(): boolean {
  const raw = process.env.TESTING_UNLIMITED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
