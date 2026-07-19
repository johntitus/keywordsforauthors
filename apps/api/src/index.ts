import {
  bsrInput,
  deepDiveInput,
  reverseAsinInput,
  searchInput,
  DISPLAY_LIMIT,
  MIN_SEARCH_VOLUME,
  RECOVERY_MAX_BOOKS,
  RECOVERY_SEARCH_LIMIT,
  RELEVANCE_ORDER,
  isNeverShow,
  relevanceTier,
  type BsrResult,
  type DeepDiveResult,
  type KeywordRow,
  type RankedKeyword,
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

type CachedRanked = { keywords: RankedKeyword[]; title: string | null; imageUrl: string | null };

/**
 * Reverse-ASIN for one book with the per-ASIN KV cache (brief §5 margin lever).
 * Shared by /api/reverse-asin and the dry-search recovery below so the cache key
 * (`reverse:v4:*`) has ONE definition — a manual reverse and a recovery warm each
 * other. Returns costUsd=0 on a cache hit.
 */
async function rankedKeywordsCached(
  env: Env,
  asin: string,
): Promise<CachedRanked & { costUsd: number; cached: boolean }> {
  const cacheKey = `reverse:v4:${asin}`; // (asin, location, filters) — v4 adds type+title+cover
  const cached = await env.CACHE.get<CachedRanked>(cacheKey, "json");
  if (cached) return { ...cached, costUsd: 0, cached: true };

  const { keywords, title, imageUrl, costUsd } = await fetchRankedKeywords(env, asin);
  await env.CACHE.put(cacheKey, JSON.stringify({ keywords, title, imageUrl } satisfies CachedRanked), {
    expirationTtl: TTL_30_DAYS,
  });
  return { keywords, title, imageUrl, costUsd, cached: false };
}

// A dry seed ("stress management for kids") returns 0 related keywords, yet Amazon
// ranks real books for it under OTHER vocabulary (self-regulation, big feelings…).
// Only mine genuine books — the product search also surfaces supplements/toys/games,
// which have no book_format and would waste a reverse-ASIN credit if reversed.
function isBookFormat(fmt: string | null): boolean {
  if (!fmt) return false;
  return /paperback|hardcover|kindle|board book|spiral|audiobook|ebook|mass market|library binding|loose leaf/i.test(
    fmt,
  );
}

/**
 * COMPETITOR MINING (memory `zero-volume-trust-problem`). Product-search the raw
 * phrase, reverse-ASIN the top book competitors, and return their keywords ranked
 * by CO-OCCURRENCE (how many of those books rank for each term = the relevance
 * signal, since reverse-ASIN has no graph depth). Runs on EVERY search now, then
 * merges with related_keywords — so we surface the vocabulary Amazon's own ranking
 * books own, whether or not the related-keyword graph knows the seed.
 */
async function mineCompetitors(
  env: Env,
  seed: string,
): Promise<{ keywords: KeywordRow[]; costUsd: number; totalResults: number | null }> {
  const { books, totalResults } = await rapidSearch(env, seed, "all", RECOVERY_SEARCH_LIMIT);
  const competitors = books.filter((b) => b.asin && isBookFormat(b.format)).slice(0, RECOVERY_MAX_BOOKS);

  // keyword -> { best volume seen, and per-book best rank } (a book can hit a
  // keyword organically + sponsored; keep its lowest rank, count the book once).
  const agg = new Map<string, { vol: number; sources: Map<string, number> }>();
  let costUsd = 0;
  for (const b of competitors) {
    const { keywords, costUsd: cost } = await rankedKeywordsCached(env, b.asin);
    costUsd += cost;
    for (const k of keywords) {
      if (!k.keyword || k.keyword === seed) continue;
      const a = agg.get(k.keyword) ?? { vol: 0, sources: new Map<string, number>() };
      a.vol = Math.max(a.vol, k.searchVolume ?? 0);
      const prev = a.sources.get(b.asin);
      a.sources.set(b.asin, prev == null ? k.rankAbsolute : Math.min(prev, k.rankAbsolute));
      agg.set(k.keyword, a);
    }
  }

  const keywords: KeywordRow[] = [...agg.entries()].map(([keyword, a]) => ({
    keyword,
    searchVolume: a.vol || null,
    depth: 0, // n/a for competitor-only rows; relevance tiers off competitorsRanking
    lastUpdatedTime: null,
    source: "reverse-asin" as const,
    competitorsRanking: a.sources.size,
    bestCompetitorRank: Math.min(...a.sources.values()),
  }));
  return { keywords, costUsd, totalResults };
}

// Merge sort key: relevance tier first (High→Low), then volume, then A→Z. Same
// ordering the SPA defaults to, so the cache and the UI agree before any click.
function byRelevance(x: KeywordRow, y: KeywordRow): number {
  return (
    RELEVANCE_ORDER[relevanceTier(y)] - RELEVANCE_ORDER[relevanceTier(x)] ||
    (y.searchVolume ?? -1) - (x.searchVolume ?? -1) ||
    x.keyword.localeCompare(y.keyword)
  );
}

/**
 * SEARCH — seed keyword → the FULL path: related keywords (graph) + the keywords
 * the ranking competitor books own (reverse-ASIN), merged into one list. Related
 * wins on collisions (it carries a real graph depth). Pattern: validate → cache →
 * fetch both on miss → merge → cache → return.
 */
app.post("/api/search", async (c) => {
  const parsed = searchInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { keyword } = parsed.data;
  // v7: + seed-level indexed-results count (2026-07-19).
  const cacheKey = `search:v7:${keyword}`; // (seed, location, depth, ignore_synonyms)

  const cached = await c.env.CACHE.get<SearchResult>(cacheKey, "json");
  if (cached) {
    // Re-apply the blocklist on the way out so newly-added junk terms are dropped
    // from already-cached results without needing to bump the cache version.
    const keywords = cached.keywords.filter((k) => !isNeverShow(k.keyword));
    return c.json({ ...cached, keywords, cached: true } satisfies SearchResult);
  }

  const [related, mined] = await Promise.all([
    fetchRelatedKeywords(c.env, keyword),
    mineCompetitors(c.env, keyword),
  ]);
  // TODO(auth): snapshot every volume on a REAL fetch (brief §5), once D1 is wired.

  // Merge: related rows first (keep their graph depth), then competitor-only rows.
  // A related keyword keeps its depth-based tier, but we still attach the competitor
  // count from the mined set when it overlaps — so the "Competitors" column is filled
  // in for related rows too (blank = none of the seed's mined books rank for it).
  const minedByKw = new Map(mined.keywords.map((m) => [m.keyword, m]));
  const byKw = new Map<string, KeywordRow>();
  for (const r of related.keywords) {
    const m = minedByKw.get(r.keyword);
    byKw.set(r.keyword, {
      ...r,
      source: "related",
      competitorsRanking: m?.competitorsRanking ?? null,
      bestCompetitorRank: m?.bestCompetitorRank ?? null,
    });
  }
  for (const m of mined.keywords) if (!byKw.has(m.keyword)) byKw.set(m.keyword, m);

  // Wipe junk (never-show blocklist) and low-demand terms, then sort High→Low and
  // cap for display. Low rows are KEPT — they fill in below High/Medium up to the
  // cap (byRelevance trims the lowest-value Low first if the set is larger).
  const keywords = [...byKw.values()]
    .filter((k) => !isNeverShow(k.keyword))
    .filter((k) => (k.searchVolume ?? 0) >= MIN_SEARCH_VOLUME)
    .sort(byRelevance)
    .slice(0, DISPLAY_LIMIT);
  const result: SearchResult = {
    seed: keyword,
    keywords,
    cached: false,
    costUsd: related.costUsd + mined.costUsd,
    seedIndexedResults: mined.totalResults,
  };
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
    // Same per-ASIN cache the dry-search recovery uses — so fan-out mining and
    // manual reverse-ASINs warm each other, driving real fetches toward zero.
    const { keywords, title, imageUrl, costUsd: cost, cached } = await rankedKeywordsCached(c.env, asin);
    costUsd += cost;
    results.push({ asin, title, imageUrl, keywords, cached });
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
