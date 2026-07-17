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

// ---------- DEEP DIVE ----------

export const deepDiveInput = z.object({
  keyword: z.string().trim().min(1).max(120).toLowerCase(),
});
export type DeepDiveInput = z.infer<typeof deepDiveInput>;

export const bookFormat = z.enum([
  "Paperback",
  "Kindle",
  "Audiobook",
  "Hardcover",
  "Cards",
  "Unknown",
]);
export type BookFormat = z.infer<typeof bookFormat>;

export const serpBook = z.object({
  rankAbsolute: z.number().int(),
  title: z.string(),
  asin: z.string(),
  priceFrom: z.number().nullable(),
  ratingValue: z.number().nullable(),
  ratingVotes: z.number().int().nullable(),
  formats: z.array(bookFormat),
  isBestSeller: z.boolean(),
  isAmazonChoice: z.boolean(),
  imageUrl: z.string().nullable(),
  url: z.string().nullable(),
});
export type SerpBook = z.infer<typeof serpBook>;

export const deepDiveResult = z.object({
  keyword: z.string(),
  books: z.array(serpBook),
  // SERP purity (brief §3.3) — the signature insight: book-format organic
  // results ÷ total organic results. 0..1.
  serpPurity: z.number().min(0).max(1),
  competitorCount: z.number().int().nonnegative().nullable(), // se_results_count
  avgReviews: z.number().nullable(),
  avgPrice: z.number().nullable(),
  titleDensity: z.number().int().nonnegative(), // P1 titles containing the phrase
  cached: z.boolean(),
  costUsd: z.number().nonnegative(),
});
export type DeepDiveResult = z.infer<typeof deepDiveResult>;

// ---------- REVERSE ASIN ----------

export const asinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^B[0-9A-Z]{9}$/, "Not a valid Amazon ASIN");

export const reverseAsinInput = z.object({
  // Batch: one credit per ASIN (brief §4). One task per ASIN under the hood.
  asins: z.array(asinSchema).min(1).max(30),
});
export type ReverseAsinInput = z.infer<typeof reverseAsinInput>;

export const rankedKeyword = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nonnegative().nullable(),
  rankAbsolute: z.number().int(),
});
export type RankedKeyword = z.infer<typeof rankedKeyword>;

export const reverseAsinResult = z.object({
  results: z.array(
    z.object({
      asin: z.string(),
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
