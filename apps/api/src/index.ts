import {
  deepDiveInput,
  reverseAsinInput,
  searchInput,
  type DeepDiveResult,
  type ReverseAsinResult,
  type SearchResult,
} from "@kfa/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./env.js";
import { computeMetrics, toSerpBook } from "./metrics.js";
import {
  fetchBooksSerp,
  fetchRankedKeywords,
  fetchRelatedKeywords,
} from "./dataforseo.js";

export { CreditLedger } from "./credit-ledger.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors());

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

/**
 * Auth gate. TODO: verify the Clerk session token with @clerk/backend and set
 * the real user ID. Scaffold accepts an `X-Debug-User` header in development.
 */
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path.startsWith("/api/webhooks/")) {
    return next();
  }
  const debugUser = c.req.header("X-Debug-User");
  if (c.env.ENVIRONMENT === "development" && debugUser) {
    c.set("userId", debugUser);
    return next();
  }
  return c.json({ error: "Unauthenticated", code: "UNAUTHENTICATED" }, 401);
});

function ledger(c: { env: Env }, userId: string) {
  return c.env.CREDIT_LEDGER.get(c.env.CREDIT_LEDGER.idFromName(userId));
}

app.get("/api/me/credits", async (c) => {
  const credits = await ledger(c, c.get("userId")).getCredits();
  return c.json({ credits });
});

/**
 * SEARCH — 1 credit. Demonstrates the full pattern the other actions follow:
 * validate → cache lookup → spend credit (idempotent) → fetch on miss →
 * snapshot on REAL fetch only → cache → return. See brief §4/§5.
 */
app.post("/api/search", async (c) => {
  const parsed = searchInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { keyword } = parsed.data;
  const userId = c.get("userId");
  const cacheKey = `search:${keyword}`; // (seed, location, depth, ignore_synonyms) — location/depth fixed for now

  // Charge a credit even on a cache hit — the user got their answer (brief §5).
  const idem = c.req.header("Idempotency-Key") ?? `search:${userId}:${keyword}`;
  const spend = await ledger(c, userId).spend(1, idem);
  if (!spend.ok) {
    return c.json({ error: "Not enough credits", code: "INSUFFICIENT_CREDITS" }, 402);
  }

  const cached = await c.env.CACHE.get<SearchResult>(cacheKey, "json");
  if (cached) {
    return c.json({ ...cached, cached: true } satisfies SearchResult);
  }

  const { keywords, costUsd } = await fetchRelatedKeywords(c.env, keyword);

  // Snapshot every volume on a REAL fetch, never on cache hits (brief §5).
  // TODO: batch-insert keyword_snapshots rows via Drizzle here.

  const result: SearchResult = { seed: keyword, keywords, cached: false, costUsd };
  await c.env.CACHE.put(cacheKey, JSON.stringify(result), {
    expirationTtl: 60 * 60 * 24 * 30, // 30-day TTL = trend cadence knob (brief §5)
  });
  return c.json(result);
});

/** DEEP DIVE — 1 credit. Cheapest action, the loop's hinge (surfaces ASINs). */
app.post("/api/deep-dive", async (c) => {
  const parsed = deepDiveInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { keyword } = parsed.data;
  const userId = c.get("userId");
  const cacheKey = `deepdive:${keyword}`;

  const idem = c.req.header("Idempotency-Key") ?? `deepdive:${userId}:${keyword}`;
  const spend = await ledger(c, userId).spend(1, idem);
  if (!spend.ok) {
    return c.json({ error: "Not enough credits", code: "INSUFFICIENT_CREDITS" }, 402);
  }

  const cached = await c.env.CACHE.get<DeepDiveResult>(cacheKey, "json");
  if (cached) return c.json({ ...cached, cached: true } satisfies DeepDiveResult);

  const { items, seResultsCount, costUsd } = await fetchBooksSerp(c.env, keyword);
  const books = items.map(toSerpBook);
  const metrics = computeMetrics(books, keyword);

  const result: DeepDiveResult = {
    keyword,
    books,
    competitorCount: seResultsCount,
    cached: false,
    costUsd,
    ...metrics,
  };
  await c.env.CACHE.put(cacheKey, JSON.stringify(result), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
  return c.json(result);
});

/** REVERSE ASIN — 1 credit PER ASIN (brief §4). */
app.post("/api/reverse-asin", async (c) => {
  const parsed = reverseAsinInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid input", code: "INVALID_INPUT" }, 400);
  }
  const { asins } = parsed.data;
  const userId = c.get("userId");

  const idem = c.req.header("Idempotency-Key") ?? `reverse:${userId}:${asins.join(",")}`;
  const spend = await ledger(c, userId).spend(asins.length, idem);
  if (!spend.ok) {
    return c.json({ error: "Not enough credits", code: "INSUFFICIENT_CREDITS" }, 402);
  }

  let costUsd = 0;
  const results = [];
  for (const asin of asins) {
    const cacheKey = `reverse:${asin}`; // (asin, location, filters) — brief §5
    const cached = await c.env.CACHE.get<{ keywords: unknown[] }>(cacheKey, "json");
    if (cached) {
      results.push({ asin, keywords: cached.keywords as never, cached: true });
      continue;
    }
    const { keywords, costUsd: cost } = await fetchRankedKeywords(c.env, asin);
    costUsd += cost;
    await c.env.CACHE.put(cacheKey, JSON.stringify({ keywords }), {
      expirationTtl: 60 * 60 * 24 * 30,
    });
    results.push({ asin, keywords, cached: false });
  }

  const payload: ReverseAsinResult = { results, costUsd, creditsSpent: asins.length };
  return c.json(payload);
});

// --- Webhooks (TODO: verify signatures) ---
app.post("/api/webhooks/clerk", (c) => c.json({ received: true })); // user.created → grant 50 credits
app.post("/api/webhooks/stripe", (c) => c.json({ received: true })); // checkout.session.completed → grant pack

export default {
  fetch: app.fetch,
  // Monthly head-term bulk_search_volume refresh (brief §5).
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // TODO: pull top ~1000 head terms from search logs, call
    // amazon_bulk_search_volume, write snapshot rows. ~$1.58/year.
  },
} satisfies ExportedHandler<Env>;
