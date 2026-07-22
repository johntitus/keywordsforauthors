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
  adminGrantInput,
  type AdminGrantResult,
  type AdminMeResult,
  type AdminUsersResult,
  type BsrResult,
  type DeepDiveResult,
  type KeywordRow,
  type KeywordSuggestResult,
  type RankedKeyword,
  type ReverseAsinResult,
  type SearchResult,
} from "@kfa/shared";
import { clerkMiddleware } from "@hono/clerk-auth";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { desc, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { CreditBalance } from "@kfa/shared";
import type { Env, Variables } from "./env.js";
import { attachUser, requireAdmin } from "./auth.js";
import {
  adminGrant,
  backfillUserEmail,
  chargeCredits,
  getBalance,
  grantSignupCredits,
  listUsers,
  removeUser,
} from "./credits.js";
import { fetchRankedKeywords, fetchRelatedKeywords } from "./dataforseo.js";
import { rapidBsr, rapidSearch } from "./rapidapi.js";
import { getDb } from "./db/client.js";
import { keywords as keywordsTable } from "./db/schema.js";

export { CreditLedger } from "./credit-ledger.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Canonicalize on the apex: 301 www.keywordsforauthors.com → keywordsforauthors.com
// (both are bound as custom domains in wrangler.toml). Runs before everything so
// the redirect is cheap and applies to API + SPA + asset requests alike.
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === "www.keywordsforauthors.com") {
    url.hostname = "keywordsforauthors.com";
    return c.redirect(url.toString(), 301);
  }
  return next();
});

app.use("*", cors());

// Verify the Clerk session (Bearer JWT from the SPA or a session cookie) and
// expose the user id as `c.var.userId` (null when signed out). Non-blocking for
// now — see auth.ts. Skips the webhook routes, which authenticate via Svix
// signature, not a session. Also skips entirely when Clerk isn't configured yet
// (no secret in .dev.vars) so the tools keep working during setup.
app.use("*", async (c, next) => {
  // Static assets + SPA client routes don't need auth — skip Clerk entirely so
  // every HTML/asset load doesn't pay session verification (handled by the
  // catch-all → ASSETS below).
  if (!c.req.path.startsWith("/api/")) return next();
  if (c.req.path.startsWith("/api/webhooks/")) return next();
  if (!c.env.CLERK_SECRET_KEY) {
    c.set("userId", null);
    return next();
  }
  return clerkMiddleware()(c, next);
});
app.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/api/")) return next();
  if (c.req.path.startsWith("/api/webhooks/")) return next();
  if (!c.env.CLERK_SECRET_KEY) return next(); // userId already null
  return attachUser(c, next);
});

// Gate the credit-bearing tool endpoints behind sign-in (decision 2026-07-19).
// Health + webhooks stay public; the SPA mirrors this with a ProtectedRoute.
// Keys off the userId that attachUser already resolved (single getAuth per
// request) — 401s signed-out requests, and fails closed if Clerk is unconfigured
// (no secret ⇒ userId null ⇒ 401), which is correct once gating is on.
const PROTECTED_PATHS = new Set([
  "/api/search",
  "/api/deep-dive",
  "/api/deep-dive/bsr",
  "/api/reverse-asin",
  "/api/keywords/suggest",
  "/api/credits",
]);
app.use("*", async (c, next) => {
  if (PROTECTED_PATHS.has(c.req.path) && !c.var.userId) {
    return c.json({ error: "Sign in to continue", code: "UNAUTHENTICATED" as const }, 401);
  }
  return next();
});

// The admin surface is gated by the email allowlist (server-enforced). Mounted
// as a group so the dynamic grant path (/users/:id/grant) is covered too.
app.use("/api/admin/*", requireAdmin);

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

// Current credit balance for the signed-in user. Provisions the free signup
// grant on first read (self-heals when the webhook hasn't landed / isn't set up).
app.get("/api/credits", async (c) => {
  const credits = await getBalance(c.env, c.var.userId!);
  return c.json({ credits } satisfies CreditBalance);
});

// --- Admin (email-allowlisted; requireAdmin mounted above) ---

// Whoami: a 200 here is how the SPA learns the user is an admin (to reveal the
// /admin route + nav link). Non-admins never reach this — requireAdmin 403s.
app.get("/api/admin/me", (c) => c.json({ email: c.var.adminEmail! } satisfies AdminMeResult));

// List users with their credit balances (the D1 projection). Rows whose email is
// still blank (lazy provisioning had no session email, and no webhook ran) get a
// one-time backfill from Clerk here — looked up by user ID and persisted, so the
// list is readable locally and later loads don't re-hit Clerk.
app.get("/api/admin/users", async (c) => {
  try {
    const users = await listUsers(c.env);
    const blanks = users.filter((u) => !u.email);
    if (blanks.length) {
      const clerk = c.get("clerk");
      await Promise.all(
        blanks.map(async (u) => {
          try {
            const cu = await clerk.users.getUser(u.id);
            const primary =
              cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) ??
              cu.emailAddresses[0];
            const email = primary?.emailAddress ?? "";
            if (email) {
              u.email = email;
              await backfillUserEmail(c.env, u.id, email);
            }
          } catch {
            // User not found in this Clerk instance / API hiccup — leave blank.
          }
        }),
      );
    }
    return c.json({ users } satisfies AdminUsersResult);
  } catch (e) {
    // Almost always D1 not migrated (run `npm run db:migrate:local` / `:remote`).
    return c.json(
      { error: `Couldn't read users: ${(e as Error).message}`, code: "DB_ERROR" as const },
      500,
    );
  }
});

// Grant gratis credits to a user (comps/support). Uses the DO's grant() + a
// mirrored credit_transactions row (reason 'admin_grant').
app.post("/api/admin/users/:id/grant", async (c) => {
  const userId = c.req.param("id");
  const parsed = adminGrantInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const credits = await adminGrant(c.env, userId, parsed.data.amount, parsed.data.reason);
  return c.json({ userId, credits } satisfies AdminGrantResult);
});

/**
 * ⚠️ AUTH + CREDITS ARE OFF for this stand-up (decided 2026-07-18): the goal is
 * to get the three tools usable without login. The Clerk gate and the per-action
 * credit spend (CreditLedger DO) are intentionally bypassed here — the DO class
 * and wiring are kept so re-enabling is a small diff, not a rebuild. Everything
 * still caches on the §5 stable keys so the margin model is exercised.
 */

const TTL_30_DAYS = 60 * 60 * 24 * 30; // KV TTL = trend cadence knob (brief §5)
const TTL_3_DAYS = 60 * 60 * 24 * 3; // deep-dive KV TTL — competitor set shifts faster

// Per-tool re-charge windows (ms) = that tool's cache TTL, so a repeat query is
// free while it's still served from cache and charges again once we'd re-fetch
// fresh data. Tie these to the SAME TTLs used for the KV puts below.
const CHARGE_WINDOW_MS = {
  search: TTL_30_DAYS * 1000,
  deep_dive: TTL_3_DAYS * 1000,
  reverse_asin: TTL_30_DAYS * 1000,
};

// 402 body when a signed-in user can't cover an action. No buy-flow yet (Stripe
// deferred), so the message just informs.
const OUT_OF_CREDITS = { error: "You're out of credits.", code: "INSUFFICIENT_CREDITS" as const };

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
 * Upsert observed keywords into the D1 autosuggest dictionary. Best-effort and
 * fire-and-forget (call via `waitUntil`): D1 may be unprovisioned and this must
 * never affect the search response. Keeps the most-recent known volume per
 * keyword and bumps a seen counter. Chunked to stay under SQLite's bound-param
 * limit; deduped so a keyword is written once per call.
 */
async function indexKeywords(
  env: Env,
  entries: { keyword: string; searchVolume: number | null; source: string }[],
): Promise<void> {
  const byKw = new Map<string, { keyword: string; searchVolume: number | null; source: string }>();
  for (const e of entries) {
    const k = e.keyword.trim().toLowerCase();
    if (!k) continue;
    const prev = byKw.get(k);
    if (!prev || (e.searchVolume ?? -1) > (prev.searchVolume ?? -1)) {
      byKw.set(k, { keyword: k, searchVolume: e.searchVolume, source: e.source });
    }
  }
  const rows = [...byKw.values()];
  if (!rows.length) return;

  const db = getDb(env);
  // D1 caps bound parameters at 100 per query; each row binds 3 columns, so keep
  // rows-per-insert × 3 well under that (25 × 3 = 75).
  const CHUNK = 25;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(keywordsTable)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: keywordsTable.keyword,
        set: {
          // Most-recent known volume wins; keep the old one if this sighting was null.
          searchVolume: sql`coalesce(excluded.search_volume, ${keywordsTable.searchVolume})`,
          seenCount: sql`${keywordsTable.seenCount} + 1`,
          updatedAt: sql`(unixepoch())`,
        },
      });
  }
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
  const userId = c.var.userId!;

  // Charge 1 credit (flat, 2026-07-20). Windowed per (user, keyword) = the search
  // cache TTL (30d): re-runs are free while served from cache and charge again once
  // we'd re-fetch fresh data. A failed fetch leaves the cache empty so a retry
  // re-runs for free. Charged on cross-user cache hits too (brief §5).
  const charge = await chargeCredits(
    c.env,
    userId,
    [`search:${userId}:${keyword}`],
    "search",
    CHARGE_WINDOW_MS.search,
  );
  if (!charge.ok) return c.json(OUT_OF_CREDITS, 402);

  // v7: + seed-level indexed-results count (2026-07-19).
  const cacheKey = `search:v7:${keyword}`; // (seed, location, depth, ignore_synonyms)

  const cached = await c.env.CACHE.get<SearchResult>(cacheKey, "json");
  if (cached) {
    // Re-apply the blocklist on the way out so newly-added junk terms are dropped
    // from already-cached results without needing to bump the cache version.
    const keywords = cached.keywords.filter((k) => !isNeverShow(k.keyword));
    // Keep the autosuggest dictionary warm even when the search itself is cached.
    c.executionCtx.waitUntil(
      indexKeywords(c.env, [
        { keyword, searchVolume: null, source: "seed" },
        ...keywords.map((k) => ({ keyword: k.keyword, searchVolume: k.searchVolume, source: k.source ?? "related" })),
      ]).catch(() => {}),
    );
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
  // Feed the autosuggest dictionary: the seed plus every keyword we surfaced.
  c.executionCtx.waitUntil(
    indexKeywords(c.env, [
      { keyword, searchVolume: null, source: "seed" },
      ...keywords.map((k) => ({ keyword: k.keyword, searchVolume: k.searchVolume, source: k.source ?? "related" })),
    ]).catch(() => {}),
  );
  return c.json(result);
});

/**
 * KEYWORD AUTOSUGGEST — prefix typeahead over the D1 dictionary of keywords we've
 * already observed, ranked by search volume. Best-effort: if D1 is unprovisioned
 * or the query fails, degrade to no suggestions rather than erroring.
 */
app.get("/api/keywords/suggest", async (c) => {
  // Strip LIKE wildcards so input can't alter the match semantics.
  const q = (c.req.query("q") ?? "").trim().toLowerCase().replace(/[%_]/g, "");
  // Min prefix 3: keeps hot 2-letter prefixes off the query (matches the client).
  if (q.length < 3) return c.json({ suggestions: [] } satisfies KeywordSuggestResult);
  try {
    const rows = await getDb(c.env)
      .select({ keyword: keywordsTable.keyword, searchVolume: keywordsTable.searchVolume })
      .from(keywordsTable)
      .where(like(keywordsTable.keyword, `${q}%`))
      .orderBy(desc(keywordsTable.searchVolume))
      .limit(10);
    return c.json({ suggestions: rows } satisfies KeywordSuggestResult);
  } catch {
    return c.json({ suggestions: [] } satisfies KeywordSuggestResult);
  }
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
  const userId = c.var.userId!;

  // Charge 1 credit for the deep dive — keyed on the keyword only, so switching
  // formats doesn't re-charge. Windowed = the deep-dive cache TTL (3d, since the
  // competitor set shifts fast): free re-runs for 3d, then charges on the fresh
  // fetch. Phase-2 BSR enrichment (/api/deep-dive/bsr) is part of this same action
  // and is NOT charged.
  const charge = await chargeCredits(
    c.env,
    userId,
    [`deep_dive:${userId}:${keyword}`],
    "deep_dive",
    CHARGE_WINDOW_MS.deep_dive,
  );
  if (!charge.ok) return c.json(OUT_OF_CREDITS, 402);

  // v2: ebook/audiobook now search the Kindle/Audible department + paginate to fill.
  const cacheKey = `deepdive:v2:${keyword}:${format}:${limit}`;

  // Feed the autosuggest dictionary with the searched keyword. A deep dive returns
  // books, not keywords, so only the seed is indexable; its volume is unknown here
  // and left null (a keyword search fills it in via the upsert's coalesce). Runs on
  // cache hits too, so any keyword used in Competitors becomes suggestable.
  c.executionCtx.waitUntil(
    indexKeywords(c.env, [{ keyword, searchVolume: null, source: "deep-dive" }]).catch(() => {}),
  );

  const cached = await c.env.CACHE.get<DeepDiveResult>(cacheKey, "json");
  if (cached) return c.json({ ...cached, cached: true } satisfies DeepDiveResult);

  const { books, returned, totalResults } = await rapidSearch(c.env, keyword, format, limit);
  const result: DeepDiveResult = { keyword, format, books, returned, totalResults, cached: false };
  // Short TTL: the competitor set shifts faster than keyword volumes. Same value
  // anchors the deep-dive re-charge window (CHARGE_WINDOW_MS.deep_dive).
  await c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL_3_DAYS });
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
  const userId = c.var.userId!;

  // Charge 1 credit for the whole reverse-ASIN action (flat, like search/deep-dive;
  // decided 2026-07-20 — simpler to intuit than per-ASIN, and popular ASINs warm the
  // per-ASIN cache anyway). Keyed on the sorted ASIN SET and windowed = the reverse
  // cache TTL (30d), so re-running the same set within the window is free. (Each
  // ASIN is still cached individually below — only the CHARGE is flat.)
  const setKey = `reverse_asin:${userId}:${[...asins].sort().join(",")}`;
  const charge = await chargeCredits(c.env, userId, [setKey], "reverse_asin", CHARGE_WINDOW_MS.reverse_asin);
  if (!charge.ok) return c.json(OUT_OF_CREDITS, 402);

  let costUsd = 0;
  const results = [];
  for (const asin of asins) {
    // Same per-ASIN cache the dry-search recovery uses — so fan-out mining and
    // manual reverse-ASINs warm each other, driving real fetches toward zero.
    const { keywords, title, imageUrl, costUsd: cost, cached } = await rankedKeywordsCached(c.env, asin);
    costUsd += cost;
    // Drop blocklisted junk (bare stopwords like "by", contraction fragments) the
    // same way /api/search does — the raw ranked cache keeps them, we filter on read.
    results.push({ asin, title, imageUrl, keywords: keywords.filter((k) => !isNeverShow(k.keyword)), cached });
  }

  // 1 if this ASIN-set was charged, 0 if it was within the free re-run window.
  const payload: ReverseAsinResult = { results, costUsd, creditsSpent: charge.chargedKeys.length };
  // Feed the autosuggest dictionary: the keywords these books rank for are real
  // Amazon keywords with volumes — exactly the corpus the typeahead wants.
  c.executionCtx.waitUntil(
    indexKeywords(
      c.env,
      results.flatMap((r) =>
        r.keywords.map((k) => ({ keyword: k.keyword, searchVolume: k.searchVolume, source: "reverse-asin" })),
      ),
    ).catch(() => {}),
  );
  return c.json(payload);
});

// --- Webhooks ---
// Clerk user lifecycle → provision users + grant free credits. Verified via the
// Svix signature (verifyWebhook), NOT a session — hence excluded from the auth
// middleware above. Returns 501 until the signing secret is configured so a
// misconfigured endpoint fails loudly rather than silently dropping grants.
app.post("/api/webhooks/clerk", async (c) => {
  if (!c.env.CLERK_WEBHOOK_SECRET) {
    return c.json({ error: "Webhook signing secret not configured" }, 501);
  }
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(c.req.raw, { signingSecret: c.env.CLERK_WEBHOOK_SECRET });
  } catch {
    return c.json({ error: "Signature verification failed" }, 400);
  }

  if (evt.type === "user.created" || evt.type === "user.updated") {
    const { id, email_addresses, primary_email_address_id } = evt.data;
    const email =
      email_addresses.find((e) => e.id === primary_email_address_id)?.email_address ??
      email_addresses[0]?.email_address;
    await grantSignupCredits(c.env, id, email);
  } else if (evt.type === "user.deleted" && evt.data.id) {
    await removeUser(c.env, evt.data.id);
  }

  return c.json({ received: true });
});

app.post("/api/webhooks/stripe", (c) => c.json({ received: true }));

// --- SPA fallback ---
// Any non-API path that didn't match a static asset is a client-side route
// (e.g. /search, /competitors). Serve the built index.html through the ASSETS
// binding, whose not_found_handling = "single-page-application" (wrangler.toml)
// returns index.html so React Router can take over. Registered last so every
// real /api route matches first. Unknown /api paths still 404 as JSON.
app.all("*", (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not found", code: "NOT_FOUND" as const }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // TODO: monthly head-term bulk_search_volume refresh (brief §5).
  },
} satisfies ExportedHandler<Env>;
