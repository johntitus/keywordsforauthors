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
   * Atomically spend 1 credit for each key that hasn't been charged **within the
   * last `windowMs`**, all-or-nothing against the balance. Each key is a distinct
   * chargeable action (a search, a deep dive, a single reverse-ASIN); its marker
   * `spent:<key>` stores the timestamp of the last charge. A key is charged again
   * only once its previous charge is older than the window — which is set to the
   * tool's cache TTL, so a re-run is free while it's still served from cache and
   * charges again when we'd re-fetch fresh data (see credits.ts / index.ts).
   * `now` is passed in (from the Worker) so the DO stays free of wall-clock reads.
   *
   * A single-unit action (search / deep dive) passes a one-element array. Retries
   * and double-clicks are inside the window ⇒ free. `ok: false` means the balance
   * couldn't cover the due keys — nothing is debited and the caller should 402.
   */
  async spendBatch(
    keys: string[],
    windowMs: number,
    now: number,
  ): Promise<{ ok: boolean; credits: number; chargedKeys: string[] }> {
    const balance = await this.balance();
    const toCharge: string[] = [];
    for (const k of keys) {
      const lastChargedAt = await this.ctx.storage.get<number>(`spent:${k}`);
      if (lastChargedAt === undefined || now - lastChargedAt >= windowMs) toCharge.push(k);
    }
    if (toCharge.length === 0) return { ok: true, credits: balance, chargedKeys: [] };

    if (balance < toCharge.length) return { ok: false, credits: balance, chargedKeys: [] };

    // One transaction: decrement + stamp every charged key with `now` together.
    const write: Record<string, number> = { credits: balance - toCharge.length };
    for (const k of toCharge) write[`spent:${k}`] = now;
    await this.ctx.storage.put(write);
    return { ok: true, credits: balance - toCharge.length, chargedKeys: toCharge };
  }

  /**
   * Reverse a prior spend for the given keys (on action failure). Only keys with a
   * live marker are credited back and cleared, so a re-run can charge again. Pass
   * the `chargedKeys` returned by `spendBatch`.
   */
  async refundBatch(keys: string[]): Promise<{ credits: number }> {
    const balance = await this.balance();
    const toRefund: string[] = [];
    for (const k of keys) {
      if ((await this.ctx.storage.get<number>(`spent:${k}`)) !== undefined) toRefund.push(k);
    }
    if (toRefund.length === 0) return { credits: balance };
    const next = balance + toRefund.length;
    await this.ctx.storage.put({ credits: next });
    await this.ctx.storage.delete(toRefund.map((k) => `spent:${k}`));
    return { credits: next };
  }
}
