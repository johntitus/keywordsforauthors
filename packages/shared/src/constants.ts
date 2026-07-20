/**
 * Load-bearing constants from ProjectBrief.md. Changing these changes the
 * product's cost model and/or data quality — read the referenced section first.
 */

// Scope: Amazon US, Books only (brief §1). Labs Amazon supports US/EG/SA/AE only.
export const LOCATION_CODE_US = 2840;
// Labs endpoints (related_keywords, ranked_keywords) take a plain language code.
export const LANGUAGE_CODE = "en";
// ⚠️ The Merchant endpoint rejects "en" (40501 Invalid Field) — it wants the
// locale form. Verified 2026-07-18. Keep these two separate.
export const MERCHANT_LANGUAGE_CODE = "en_US";
export const DEPARTMENT_BOOKS = "Books";

// SEARCH — related_keywords (brief §3.1). depth 3 is the decided sweet spot;
// depth 4 ~triples spend for mostly-noise keywords 4 hops from the seed.
export const SEARCH_DEPTH = 3;
export const SEARCH_LIMIT = 258; // DataForSEO related_keywords `limit` — ≈ max at depth 3

// Max rows shown for a search after merge + filters (a deliberate display cap,
// distinct from the API limit above). Sorted High→Medium→Low, so if the merged
// set exceeds this the lowest-value Low rows are trimmed first.
export const DISPLAY_LIMIT = 250;

// REVERSE ASIN — ranked_keywords (brief §3.2). This endpoint is DANGEROUS
// unfiltered (a WiFi extender "ranks" for "baby girl"). These filters are
// MANDATORY on every call. rank_absolute<20 is the single highest-leverage
// number in the product and is an UNSETTLED guess (open question §10.1) — it is
// part of the reverse-ASIN cache key, so tuning it invalidates cached rows.
export const REVERSE_ASIN_MAX_RANK = 20;
export const REVERSE_ASIN_MIN_VOLUME = 50;

// DEEP DIVE — merchant/amazon/products (brief §3.3). Only organic book results
// count toward competition metrics; never average sponsored/editorial in.
export const SERP_ORGANIC_TYPE = "amazon_serp";

// COMPETITOR MINING (memory `zero-volume-trust-problem`). Originally a dry-search
// fallback; now runs on EVERY search (in parallel with related_keywords) — it mines
// the ranking competitors' vocabulary via reverse-ASIN, which fills the Competitors
// count and strengthens the co-occurrence relevance signal, and still recovers terms
// that return 0 related keywords. Cost note: each mined book = 1 reverse-ASIN call
// (KV-cached), and this is the DOMINANT per-search cost, so this cap is the main
// credit/latency knob.
// Hard floor on displayed keywords — wipe anything below this many US searches
// (a barely-searched term isn't worth a row). Applied in /api/search after merge.
export const MIN_SEARCH_VOLUME = 100;

export const RECOVERY_SEARCH_LIMIT = 30; // competitors to scan before filtering to books
export const RECOVERY_MAX_BOOKS = 8; // book competitors to actually reverse-ASIN
// ↓ 8 (was 15): dialed back for cost — 15 was ~$0.24 of reverse-ASIN calls per COLD
// search (the dominant cost; a cold search runs deeply negative at 1 credit). 8 keeps
// a usable co-occurrence signal and still populates the per-ASIN KV cache, at ~half
// the cold cost. Warm repeats stay cheap regardless (per-ASIN cache, brief §5).

// Credit model (brief §4): EVERY action = 1 credit, flat (don't price by underlying
// cost — eat the 6× variance). Decided 2026-07-20; reverse-ASIN went from per-ASIN
// back to a flat 1-per-action (2026-07-20, easier to intuit; popular ASINs warm the
// per-ASIN cache anyway). Charging is WINDOWED per (user, action-input): a repeat is
// free while still served from cache and charges again once we'd re-fetch fresh data.
// Window = each tool's cache TTL (CHARGE_WINDOW_MS in the Worker: search 30d, deep
// dive 3d, reverse ASIN 30d — keyed on the sorted ASIN SET). Retries/double-clicks
// fall inside the window ⇒ free; cross-user cache hits still charge (brief §5).
export const CREDIT_COSTS = { search: 1, deep_dive: 1, reverse_asin: 1 } as const;

export const FREE_SIGNUP_CREDITS = 50;

export const CREDIT_PACKS = [
  { id: "starter", name: "Starter pack", credits: 100, priceUsd: 12 },
  { id: "working", name: "Working pack", credits: 500, priceUsd: 45 },
  { id: "studio", name: "Studio pack", credits: 2000, priceUsd: 120 },
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"];

// The three actions, each of which costs credits and is cacheable (brief §5).
export const ACTIONS = ["search", "deep_dive", "reverse_asin"] as const;
export type Action = (typeof ACTIONS)[number];
