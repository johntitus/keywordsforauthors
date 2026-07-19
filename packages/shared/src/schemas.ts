import { z } from "zod";

/**
 * API contract shared by the Worker (validates input, shapes output) and the
 * SPA (typed fetch + form validation). These describe OUR api surface — the
 * trimmed shapes we return to the client — not the raw DataForSEO payloads,
 * which are far larger and stripped server-side (brief §3.2 "payload bloat").
 */

// ---------- SEARCH ----------

export const searchInput = z.object({
  keyword: z.string().trim().min(1).max(120).toLowerCase(),
});
export type SearchInput = z.infer<typeof searchInput>;

// Where a keyword row came from. Every SEARCH now runs the FULL path (related
// keywords + competitor mining), so a row is one of:
//  - "related": DataForSEO related_keywords — relevance = graph `depth`.
//  - "reverse-asin": found ONLY via the competitors Amazon ranks for the seed
//    (not in the related set) — reverse-ASIN has no graph depth, so relevance =
//    `competitorsRanking` (how many competitor books rank for it).
export const keywordSource = z.enum(["related", "reverse-asin"]);
export type KeywordSource = z.infer<typeof keywordSource>;

export const keywordRow = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nonnegative().nullable(),
  depth: z.number().int().nonnegative(),
  lastUpdatedTime: z.string().nullable(),
  // Provenance + the relevance inputs. `source` absent ⇒ treat as "related".
  source: keywordSource.optional(),
  // Set only on "reverse-asin" rows: how many competitor books rank for it, and
  // the best (lowest) SERP rank any of them holds.
  competitorsRanking: z.number().int().nonnegative().nullable().optional(),
  bestCompetitorRank: z.number().int().positive().nullable().optional(),
});
export type KeywordRow = z.infer<typeof keywordRow>;

export const searchResult = z.object({
  seed: z.string(),
  keywords: z.array(keywordRow),
  cached: z.boolean(),
  costUsd: z.number().nonnegative(),
  // Total indexed Amazon results for the SEED phrase itself (RapidAPI
  // `total_products` from the one seed search we already run) — a free
  // competition figure for the searched term. null if the search returned none.
  seedIndexedResults: z.number().int().nonnegative().nullable().optional(),
});
export type SearchResult = z.infer<typeof searchResult>;

// ---------- Relevance tiering (shared by Worker sort/cap + SPA label) ----------
// One definition so the Worker and the UI agree.
//
// Related rows tier off graph `depth` (fewer hops = closer). Competitor rows
// BLEND three signals and take the strongest (product call 2026-07-19), because
// pure co-occurrence buried broad on-theme terms — e.g. "mental health" (70k
// searches) came from a single mined book, so it scored Low. The blend:
//   - co-occurrence : how many competitor books rank for it (ownership breadth)
//   - best rank     : the lowest SERP rank any competitor holds (ownership depth —
//                     a book ranking top-3 strongly "owns" the term)
//   - demand        : raw search volume can lift a term to Medium (never High), so
//                     a prominent on-theme head term isn't buried by low overlap
// All thresholds are tunable knobs — tune here and both Worker and UI follow.
export type RelevanceTier = "High" | "Medium" | "Low";
export const RELEVANCE_ORDER: Record<RelevanceTier, number> = { High: 3, Medium: 2, Low: 1 };

// Breadth (how many books own the term) IS the tier. A keyword only one book
// ranks for isn't really ownable/actionable — even at high volume — so Medium now
// requires ≥2 books (was: also lifted by a single top-3 rank or high volume, which
// bloated Medium). A top-3 rank only *corroborates* 2-book ownership into High.
// Single-book terms fall to "Low" and are DISCARDED by the Worker. (Demand is
// handled separately by the MIN_SEARCH_VOLUME floor, not by the tier.)
const CO_HIGH = 3; // ≥ this many ranking books ⇒ High
const CO_MEDIUM = 2; // 2 books ⇒ Medium; 2 books with a top-3 rank ⇒ High
const RANK_STRONG = 3; // a competitor ranks it top-3 = strong ownership (lifts 2-book → High)

export function relevanceTier(
  row: Pick<KeywordRow, "source" | "depth" | "competitorsRanking" | "bestCompetitorRank" | "searchVolume">,
): RelevanceTier {
  if (row.source === "reverse-asin") {
    const n = row.competitorsRanking ?? 0;
    const rank = row.bestCompetitorRank ?? Infinity;
    if (n >= CO_HIGH) return "High";
    if (n >= CO_MEDIUM && rank <= RANK_STRONG) return "High"; // 2 books, one owns it top-3
    if (n >= CO_MEDIUM) return "Medium";
    return "Low";
  }
  // related_keywords: graph depth (0 = seed itself).
  if (row.depth <= 1) return "High";
  if (row.depth <= 3) return "Medium";
  return "Low";
}

// ---------- DEEP DIVE (RapidAPI real-time-amazon-data, BSR hybrid) ----------
// Switched from DataForSEO Merchant to RapidAPI on 2026-07-18 because RapidAPI
// returns BSR + author + publisher + page count (memory `bsr-via-rapidapi-hybrid`).
// Two phases: (1) SEARCH renders the competitor table fast; (2) BSR enrichment
// fills the load-bearing columns per ASIN. The SPA fires them back-to-back and
// fills rows progressively.

export const bookFormatFilter = z.enum(["all", "paperback", "ebook", "audiobook"]);
export type BookFormatFilter = z.infer<typeof bookFormatFilter>;

export const deepDiveInput = z.object({
  keyword: z.string().trim().min(1).max(120).toLowerCase(),
  format: bookFormatFilter.default("all"),
  // Cap 20 competitors (settled decision) — every row shown gets full BSR.
  limit: z.number().int().min(1).max(48).default(20),
});
export type DeepDiveInput = z.infer<typeof deepDiveInput>;

/**
 * One competitor row. BSR fields (author/bsrInBooks/bsrStore/publisher/pages)
 * arrive null from phase 1 and are backfilled by the phase-2 BSR call.
 */
export const serpBook = z.object({
  order: z.number().int().nonnegative(), // relevance order (stable sort key)
  title: z.string(),
  asin: z.string(),
  imageUrl: z.string().nullable(),
  format: z.string().nullable(), // RapidAPI's book_format label, e.g. "Paperback"
  priceFrom: z.number().nullable(),
  ratingValue: z.number().nullable(),
  ratingVotes: z.number().int().nullable(),
  isBestSeller: z.boolean(),
  isAmazonChoice: z.boolean(),
  url: z.string().nullable(),
  // --- filled by phase 2 (BSR enrichment) ---
  author: z.string().nullable(),
  bsrInBooks: z.number().int().nullable(), // "#N in Books" — the only cross-store-comparable rank
  bsrRank: z.number().int().nullable(), // primary rank in whatever store the book lives (Books/Kindle/Audible)
  bsrStore: z.string().nullable(), // store the rank is on (Books / Kindle / Office Products…)
  publisher: z.string().nullable(),
  pages: z.number().int().nullable(),
});
export type SerpBook = z.infer<typeof serpBook>;

/** Phase 1 — search: the competitor table, BSR columns still null. */
export const deepDiveResult = z.object({
  keyword: z.string(),
  format: bookFormatFilter,
  books: z.array(serpBook),
  returned: z.number().int().nonnegative(),
  totalResults: z.number().int().nonnegative().nullable(), // indexed results on Amazon
  cached: z.boolean(),
});
export type DeepDiveResult = z.infer<typeof deepDiveResult>;

// Phase 2 — BSR enrichment, keyed by ASIN.
export const bsrInput = z.object({
  asins: z.array(z.string().trim().min(1)).min(1).max(48),
});
export type BsrInput = z.infer<typeof bsrInput>;

export const bsrRow = z.object({
  author: z.string().nullable(),
  bsrInBooks: z.number().int().nullable(),
  bsrRank: z.number().int().nullable(),
  bsrStore: z.string().nullable(),
  publisher: z.string().nullable(),
  pages: z.number().int().nullable(),
  // Audiobooks report $0.00 in phase-1 search; the real price lives in phase-2
  // product-details, so it's backfilled here. Omitted for print (keep search price).
  priceFrom: z.number().nullable().optional(),
});
export type BsrRow = z.infer<typeof bsrRow>;

export const bsrResult = z.object({
  byAsin: z.record(z.string(), bsrRow),
  cacheHits: z.number().int().nonnegative(),
  asinsCharged: z.number().int().nonnegative(),
});
export type BsrResult = z.infer<typeof bsrResult>;

// ---------- REVERSE ASIN ----------

// 10 chars: B0-prefixed ASINs AND numeric ISBN-10s (many older books use their
// ISBN-10 as the ASIN, and those flow in from the deep-dive → reverse-ASIN handoff).
export const asinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{10}$/, "Not a valid Amazon ASIN");

export const reverseAsinInput = z.object({
  // Batch: one credit per ASIN (brief §4). One task per ASIN under the hood.
  // Capped at 10 to keep the per-run credit cost bounded.
  asins: z.array(asinSchema).min(1).max(10),
});
export type ReverseAsinInput = z.infer<typeof reverseAsinInput>;

// A book can rank for the same keyword both organically (amazon_serp) and via a
// sponsored ad (amazon_paid) — DataForSEO returns one row per placement, so the
// `type` distinguishes them (otherwise they look like duplicate rows).
export const rankPlacement = z.enum(["organic", "sponsored", "other"]);
export type RankPlacement = z.infer<typeof rankPlacement>;

export const rankedKeyword = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nonnegative().nullable(),
  rankAbsolute: z.number().int(),
  type: rankPlacement.default("organic"),
});
export type RankedKeyword = z.infer<typeof rankedKeyword>;

export const reverseAsinResult = z.object({
  results: z.array(
    z.object({
      asin: z.string(),
      // The book's title + cover, pulled from the same ranked_keywords call
      // (serp_item.title / image_url) so ASINs are human-readable. Null if absent.
      title: z.string().nullable(),
      imageUrl: z.string().nullable(),
      keywords: z.array(rankedKeyword),
      cached: z.boolean(),
    }),
  ),
  costUsd: z.number().nonnegative(),
  creditsSpent: z.number().int().nonnegative(),
});
export type ReverseAsinResult = z.infer<typeof reverseAsinResult>;

// ---------- Keyword autosuggest ----------

// Typeahead over keywords we've already observed (seed searches + related +
// reverse-ASIN results), ranked by search volume. Prefix match, served from D1.
export const keywordSuggestion = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nullable(),
});
export type KeywordSuggestion = z.infer<typeof keywordSuggestion>;

export const keywordSuggestResult = z.object({
  suggestions: z.array(keywordSuggestion),
});
export type KeywordSuggestResult = z.infer<typeof keywordSuggestResult>;

// ---------- Account / credits ----------

export const creditBalance = z.object({
  credits: z.number().int().nonnegative(),
});
export type CreditBalance = z.infer<typeof creditBalance>;

export const apiError = z.object({
  error: z.string(),
  code: z.enum([
    "INSUFFICIENT_CREDITS",
    "INVALID_INPUT",
    "UPSTREAM_ERROR",
    "RATE_LIMITED",
    "UNAUTHENTICATED",
    "INTERNAL",
  ]),
});
export type ApiError = z.infer<typeof apiError>;
