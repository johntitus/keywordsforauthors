import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.js";

/**
 * One instance per user (addressed by Clerk user ID). Serializes all credit
 * reads/writes so concurrent actions and double-clicks can't double-spend or
 * race (brief §8.2 idempotency; TechStack.md "Consistency / idempotency").
 *
 * This DO owns the running balance in its own SQLite storage. The D1 `users`
 * row is a projection updated alongside for querying/reporting.
 */
export class CreditLedger extends DurableObject<Env> {
  private async balance(): Promise<number> {
    return (await this.ctx.storage.get<number>("credits")) ?? 0;
  }

  async getCredits(): Promise<number> {
    return this.balance();
  }

  async grant(amount: number): Promise<number> {
    const next = (await this.balance()) + amount;
    await this.ctx.storage.put("credits", next);
    return next;
  }

  /**
   * Grant `amount` exactly once per `key`. Used for the signup grant so that a
   * retried webhook AND a lazy first-read (see credits.ts) can both call it
   * without ever double-granting. `granted` tells the caller whether this call
   * was the one that actually applied the credits (so it can write the ledger
   * row / backfill projections only once).
   */
  async grantOnce(amount: number, key: string): Promise<{ credits: number; granted: boolean }> {
    const seen = `granted:${key}`;
    if ((await this.ctx.storage.get<number>(seen)) !== undefined) {
      return { credits: await this.balance(), granted: false };
    }
    const next = (await this.balance()) + amount;
    await this.ctx.storage.put({ credits: next, [seen]: amount });
    return { credits: next, granted: true };
  }

  /** Wipe this user's ledger (on account deletion). */
  async reset(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  /**
   * Atomically spend `amount` credits if the same idempotencyKey hasn't already
   * been charged. Returns the outcome so the caller can 402 on insufficient
   * funds. Re-issuing the same key (a retried/double-clicked request) is a no-op
   * that reports the already-charged result.
   */
  async spend(
    amount: number,
    idempotencyKey: string,
  ): Promise<{ ok: boolean; credits: number; alreadyCharged: boolean }> {
    const seenKey = `spent:${idempotencyKey}`;
    const already = await this.ctx.storage.get<number>(seenKey);
    if (already !== undefined) {
      return { ok: true, credits: await this.balance(), alreadyCharged: true };
    }
    const current = await this.balance();
    if (current < amount) {
      return { ok: false, credits: current, alreadyCharged: false };
    }
    const next = current - amount;
    // Single transaction: decrement + record the idempotency marker together.
    await this.ctx.storage.put({ credits: next, [seenKey]: amount });
    return { ok: true, credits: next, alreadyCharged: false };
  }
}
