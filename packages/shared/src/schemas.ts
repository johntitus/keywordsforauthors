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

export const keywordRow = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nonnegative().nullable(),
  depth: z.number().int().nonnegative(),
  lastUpdatedTime: z.string().nullable(),
});
export type KeywordRow = z.infer<typeof keywordRow>;

export const searchResult = z.object({
  seed: z.string(),
  keywords: z.array(keywordRow),
  cached: z.boolean(),
  costUsd: z.number().nonnegative(),
});
export type SearchResult = z.infer<typeof searchResult>;

// ---------- DEEP DIVE (RapidAPI real-time-amazon-data, BSR hybrid) ----------
// Switched from DataForSEO Merchant to RapidAPI on 2026-07-18 because RapidAPI
// returns BSR + author + publisher + page count (memory `bsr-via-rapidapi-hybrid`).
// Two phases: (1) SEARCH renders the competitor table fast; (2) BSR enrichment
// fills the load-bearing columns per ASIN. The SPA fires them back-to-back and
// fills rows progressively.

export const bookFormatFilter = z.enum(["all", "paperback", "ebook"]);
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
  bsrInBooks: z.number().int().nullable(), // "#N in Books" — the only comparable rank
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
  bsrStore: z.string().nullable(),
  publisher: z.string().nullable(),
  pages: z.number().int().nullable(),
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
  asins: z.array(asinSchema).min(1).max(30),
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
