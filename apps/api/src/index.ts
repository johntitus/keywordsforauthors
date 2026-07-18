import {
  bsrInput,
  deepDiveInput,
  reverseAsinInput,
  searchInput,
  type BsrResult,
  type DeepDiveResult,
  type ReverseAsinResult,
  type SearchResult,
} from "@kfa/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./env.js";
import { fetchRankedKeywords, fetchRelatedKeywords } from "./dataforseo.js";
import { rapidBsr, rapidSearch } from "./rapidapi.js";

export { CreditLedger } from "./credit-ledger.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors());

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

/**
 * ⚠️ AUTH + CREDITS ARE OFF for this stand-up (decided 2026-07-18): the goal is
 * to get the three tools usable without login. The Clerk gate and the per-action
 * credit spend (CreditLedger DO) are intentionally bypassed here — the DO class
 * and wiring are kept so re-enabling is a small diff, not a rebuild. Everything
 * still caches on the §5 stable keys so the margin model is exercised.
 */

const TTL_30_DAYS = 60 * 60 * 24 * 30; // KV TTL = trend cadence knob (brief §5)

/**
 * SEARCH — seed keyword → related keywords + Amazon volumes (brief §3.1).
 * Pattern: validate → cache lookup → fetch on miss → cache → return.
 */
app.post("/api/search", async (c) => {
  const parsed = searchInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { keyword } = parsed.data;
  const cacheKey = `search:${keyword}`; // (seed, location, depth, ignore_synonyms)

  const cached = await c.env.CACHE.get<SearchResult>(cacheKey, "json");
  if (cached) return c.json({ ...cached, cached: true } satisfies SearchResult);

  const { keywords, costUsd } = await fetchRelatedKeywords(c.env, keyword);
  // TODO(auth): snapshot every volume on a REAL fetch (brief §5), once D1 is wired.

  const result: SearchResult = { seed: keyword, keywords, cached: false, costUsd };
  await c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL_30_DAYS });
  return c.json(result);
});

/**
 * DEEP DIVE (phase 1) — RapidAPI search → the competitor table for a keyword,
 * capped at `limit` (default 20). BSR columns come back null; the SPA fills them
 * via /api/deep-dive/bsr. Cached on (keyword, format, limit).
 */
app.post("/api/deep-dive", async (c) => {
  const parsed = deepDiveInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { keyword, format, limit } = parsed.data;
  const cacheKey = `deepdive:${keyword}:${format}:${limit}`;

  const cached = await c.env.CACHE.get<DeepDiveResult>(cacheKey, "json");
  if (cached) return c.json({ ...cached, cached: true } satisfies DeepDiveResult);

  const { books, returned, totalResults } = await rapidSearch(c.env, keyword, format, limit);
  const result: DeepDiveResult = { keyword, format, books, returned, totalResults, cached: false };
  // Short TTL: the competitor set shifts faster than keyword volumes.
  await c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 3 });
  return c.json(result);
});

/**
 * DEEP DIVE (phase 2) — per-ASIN BSR / author / publisher / pages. Each ASIN is
 * KV-cached (the margin lever). Fired in small concurrent batches by the SPA so
 * rows fill progressively without tripping RapidAPI's burst limit.
 */
app.post("/api/deep-dive/bsr", async (c) => {
  const parsed = bsrInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { byAsin, cacheHits, asinsCharged } = await rapidBsr(c.env, parsed.data.asins);
  return c.json({ byAsin, cacheHits, asinsCharged } satisfies BsrResult);
});

/**
 * REVERSE ASIN — the keywords a book actually ranks for (brief §3.2). Mandatory
 * server-side filter (rank_absolute<20, volume>50) lives in the client. Per-ASIN
 * KV cache on (asin, location, filters).
 */
app.post("/api/reverse-asin", async (c) => {
  const parsed = reverseAsinInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { asins } = parsed.data;

  let costUsd = 0;
  const results = [];
  for (const asin of asins) {
    const cacheKey = `reverse:v4:${asin}`; // (asin, location, filters) — brief §5. v4: added placement type + title + cover.
    const cached = await c.env.CACHE.get<{ keywords: unknown[]; title: string | null; imageUrl: string | null }>(
      cacheKey,
      "json",
    );
    if (cached) {
      results.push({
        asin,
        title: cached.title ?? null,
        imageUrl: cached.imageUrl ?? null,
        keywords: cached.keywords as never,
        cached: true,
      });
      continue;
    }
    const { keywords, title, imageUrl, costUsd: cost } = await fetchRankedKeywords(c.env, asin);
    costUsd += cost;
    await c.env.CACHE.put(cacheKey, JSON.stringify({ keywords, title, imageUrl }), {
      expirationTtl: TTL_30_DAYS,
    });
    results.push({ asin, title, imageUrl, keywords, cached: false });
  }

  const payload: ReverseAsinResult = { results, costUsd, creditsSpent: asins.length };
  return c.json(payload);
});

// --- Webhooks (kept for when auth returns; no-ops for now) ---
app.post("/api/webhooks/clerk", (c) => c.json({ received: true }));
app.post("/api/webhooks/stripe", (c) => c.json({ received: true }));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // TODO: monthly head-term bulk_search_volume refresh (brief §5).
  },
} satisfies ExportedHandler<Env>;
