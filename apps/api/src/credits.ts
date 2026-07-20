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

/**
 * Charge 1 credit per key (flat pricing), all-or-nothing, skipping keys charged
 * for this user **within the last `windowMs`** (repeats/retries inside the window
 * are free; after it — once the cached result would be re-fetched — the same query
 * charges again). Each key is a distinct chargeable unit — a search, a deep dive,
 * or one reverse-ASIN. `windowMs` = the tool's cache TTL, so price tracks fresh
 * fetches. Returns `{ ok, credits, chargedKeys }`; `ok: false` ⇒ insufficient
 * balance (caller 402s). Best-effort mirrors the debit into D1 + a ledger row/key.
 */
export async function chargeCredits(
  env: Env,
  userId: string,
  keys: string[],
  reason: string,
  windowMs: number,
): Promise<{ ok: boolean; credits: number; chargedKeys: string[] }> {
  // Ensure the free signup grant exists before charging — a brand-new user might
  // hit an action before the nav pill's /api/credits call provisions them, and we
  // don't want a false "out of credits" on their very first search. Idempotent.
  await grantSignupCredits(env, userId);
  const now = Date.now();
  const res = await ledgerStub(env, userId).spendBatch(keys, windowMs, now);
  if (res.ok && res.chargedKeys.length > 0) {
    try {
      const db = getDb(env);
      await db.update(users).set({ credits: res.credits }).where(eq(users.id, userId));
      await db
        .insert(creditTransactions)
        .values(
          res.chargedKeys.map((k) => ({
            id: crypto.randomUUID(),
            userId,
            delta: -1,
            reason,
            // Include `now` so a windowed re-charge of the same key doesn't collide
            // with the unique constraint (each real charge is its own ledger row).
            idempotencyKey: `spend:${k}:${now}`,
          })),
        )
        .onConflictDoNothing();
    } catch {
      // D1 unprovisioned — the DO already recorded the authoritative debit.
    }
  }
  return res;
}

/** Reverse a charge (on action failure). Pass the `chargedKeys` from chargeCredits. */
export async function refundCharge(env: Env, userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const res = await ledgerStub(env, userId).refundBatch(keys);
  try {
    const db = getDb(env);
    await db.update(users).set({ credits: res.credits }).where(eq(users.id, userId));
  } catch {
    // D1 unprovisioned — DO refund already applied.
  }
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
