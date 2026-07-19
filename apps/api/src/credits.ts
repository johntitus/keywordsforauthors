import { FREE_SIGNUP_CREDITS } from "@kfa/shared";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client.js";
import { creditTransactions, users } from "./db/schema.js";
import type { Env } from "./env.js";

/**
 * Credit provisioning. Deduction is intentionally NOT wired yet (decision
 * 2026-07-19) — this module only GRANTS the free signup credits and reads the
 * balance. The CreditLedger Durable Object owns the authoritative balance; the
 * D1 `users` row is a projection for reporting.
 *
 * The signup grant is idempotent (DO `grantOnce`, keyed per user), so it can be
 * driven from two places without double-granting:
 *   - the Clerk `user.created` webhook (the proper, eventually-consistent path), and
 *   - a lazy first-read in GET /api/credits (self-heals the local-dev case where
 *     no webhook tunnel is configured, and the gap before the webhook lands).
 */
const SIGNUP_KEY = "signup";

function ledgerStub(env: Env, userId: string) {
  return env.CREDIT_LEDGER.get(env.CREDIT_LEDGER.idFromName(userId));
}

/**
 * Ensure the user has been granted their free credits, and keep the D1
 * projection in sync. Returns the current balance. Safe to call on every
 * balance read. `email` is written when known (webhook payload); a lazy read
 * passes it undefined and lets the webhook backfill it.
 */
export async function grantSignupCredits(
  env: Env,
  userId: string,
  email?: string,
): Promise<number> {
  const { credits, granted } = await ledgerStub(env, userId).grantOnce(FREE_SIGNUP_CREDITS, SIGNUP_KEY);

  // Only touch D1 when there's something to write (first grant, or a real email
  // to persist) — a plain balance read stays a single DO call.
  if (granted || email != null) {
    try {
      const db = getDb(env);
      await db
        .insert(users)
        .values({ id: userId, email: email ?? "", credits })
        .onConflictDoUpdate({
          target: users.id,
          set: email != null ? { credits, email } : { credits },
        });
      if (granted) {
        await db
          .insert(creditTransactions)
          .values({
            id: crypto.randomUUID(),
            userId,
            delta: FREE_SIGNUP_CREDITS,
            reason: "signup",
            idempotencyKey: `signup:${userId}`,
          })
          .onConflictDoNothing();
      }
    } catch {
      // D1 unprovisioned (placeholder id in wrangler.toml) — the DO still holds
      // the authoritative balance, so the grant isn't lost. Projection catches
      // up once D1 exists.
    }
  }
  return credits;
}

/** Read the current balance, provisioning the signup grant on first read. */
export async function getBalance(env: Env, userId: string): Promise<number> {
  return grantSignupCredits(env, userId);
}

/** Remove a user on account deletion (best-effort projection + ledger wipe). */
export async function removeUser(env: Env, userId: string): Promise<void> {
  await ledgerStub(env, userId).reset();
  try {
    const db = getDb(env);
    // Transactions FK-reference the user, so clear them first.
    await db.delete(creditTransactions).where(eq(creditTransactions.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  } catch {
    // D1 unprovisioned — nothing to clean up there.
  }
}
