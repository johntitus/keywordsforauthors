import type { BsrRow, SerpBook } from "@kfa/shared";
import type { Env } from "./env.js";

/**
 * RapidAPI `real-time-amazon-data` client — the DEEP DIVE data source since
 * 2026-07-18 (memory `bsr-via-rapidapi-hybrid`). DataForSEO still powers search
 * and reverse-asin; only the deep dive moved here, because RapidAPI returns the
 * things DataForSEO can't: BSR, author, publisher, page count.
 *
 * Load-bearing details this file encodes:
 *  - BSR is an unparsed string; only "#N in Books" is comparable across books.
 *  - Billing is per ASIN RETURNED (dropped ASINs are free) + 1 per search.
 *  - RapidAPI rate-limits bursts (~10 concurrent → 429); we retry 429 w/ backoff.
 *  - `product-details` batches (≤10) can silently drop ASINs → reconcile + retry once.
 *  - Server-side paperback filter is unreliable → also post-filter book_format.
 *  - Per-ASIN BSR cache (KV) is the margin lever — warm repeats ≈ near-zero fetches.
 */

const RAPIDAPI_HOST = "real-time-amazon-data.p.rapidapi.com";
const RAPIDAPI_PAPERBACK_BIN = "p_n_feature_browse-bin:2656022011";
const BSR_TTL_SECONDS = 7 * 24 * 60 * 60; // BSR drifts daily; 7 days is a safe cache

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parsePrice(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// RapidAPI titles/authors arrive HTML-encoded ("Don&#x27;t Sweat"). Decode to
// real characters; the client re-escapes once for display (no double-encoding).
function decodeEntities(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function parseBsrInBooks(info: Record<string, unknown>): number | null {
  const raw = info?.["Best Sellers Rank"];
  if (typeof raw !== "string") return null;
  const m = raw.match(/#([\d,]+)\s+in Books/);
  return m?.[1] ? Number(m[1].replace(/,/g, "")) : null;
}

// The store the FIRST rank is on ("in Books" / "Free in Kindle Store" / …) — so a
// non-Books rank is visibly flagged rather than silently compared as if it were one.
function parseBsrStore(info: Record<string, unknown>): string | null {
  const raw = info?.["Best Sellers Rank"];
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^#[\d,]+\s+(.+?)\s*(?:\(|$)/);
  return m?.[1] ? m[1].trim() : null;
}

function parsePages(info: Record<string, unknown>): number | null {
  const raw = info?.["Print length"];
  if (typeof raw !== "string") return null;
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

async function rapidGet(
  env: Env,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<any> {
  const url = new URL("https://" + RAPIDAPI_HOST + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      headers: { "x-rapidapi-key": env.RAPIDAPI_KEY, "x-rapidapi-host": RAPIDAPI_HOST },
    });
    if (res.status === 429 && attempt < 4) {
      await sleep(400 * (attempt + 1)); // 0.4s, 0.8s, 1.2s, 1.6s
      continue;
    }
    break;
  }
  if (!res!.ok) throw new Error("RapidAPI " + path + " -> " + res!.status);
  return res!.json();
}

// ---------- Phase 1: search (fast, no BSR yet) ----------

export async function rapidSearch(
  env: Env,
  keyword: string,
  format: "all" | "paperback" | "ebook",
  limit: number,
): Promise<{ books: SerpBook[]; returned: number; totalResults: number | null }> {
  const bin = format === "paperback" ? RAPIDAPI_PAPERBACK_BIN : undefined;
  const search = await rapidGet(env, "/search", {
    query: keyword.toLowerCase(),
    country: "US",
    page: 1,
    sort_by: "RELEVANCE",
    additional_filters: bin,
  });

  const matchFmt = (f: unknown) => {
    if (format === "all") return true;
    const t = String(f || "").toLowerCase();
    if (format === "paperback") return t.includes("paperback");
    if (format === "ebook") return t.includes("kindle") || t.includes("ebook");
    return true;
  };

  const books: SerpBook[] = (search?.data?.products ?? [])
    .filter((p: any) => matchFmt(p.book_format))
    .slice(0, limit)
    .map((p: any, order: number) => ({
      order,
      title: decodeEntities(p.product_title ?? ""),
      asin: String(p.asin ?? ""),
      imageUrl: p.product_photo ?? null,
      format: p.book_format ?? null,
      priceFrom: parsePrice(p.product_price),
      ratingValue: p.product_star_rating != null ? Number(p.product_star_rating) : null,
      ratingVotes: p.product_num_ratings ?? null,
      isBestSeller: !!p.is_best_seller,
      isAmazonChoice: !!p.is_amazon_choice,
      url: p.product_url ?? null,
      author: null,
      bsrInBooks: null,
      bsrStore: null,
      publisher: null,
      pages: null,
    }));

  return { books, returned: books.length, totalResults: search?.data?.total_products ?? null };
}

// ---------- Phase 2: BSR enrichment (per-ASIN, KV cached) ----------

const bsrCacheKey = (asin: string) => `bsr:${asin}`;

export async function rapidBsr(
  env: Env,
  asins: string[],
): Promise<{ byAsin: Record<string, BsrRow>; cacheHits: number; asinsCharged: number }> {
  const byAsin: Record<string, BsrRow> = {};
  const misses: string[] = [];

  // KV per-ASIN cache first — bestsellers & same-imprint titles recur across
  // keywords, so this collapses real RapidAPI usage on warm repeats.
  await Promise.all(
    asins.map(async (a) => {
      const hit = await env.CACHE.get<BsrRow>(bsrCacheKey(a), "json");
      if (hit) byAsin[a] = hit;
      else misses.push(a);
    }),
  );
  const cacheHits = asins.length - misses.length;

  const fetched = new Map<string, any>();
  let asinsCharged = 0;
  const batches: string[][] = [];
  for (let i = 0; i < misses.length; i += 10) batches.push(misses.slice(i, i + 10));

  await Promise.all(
    batches.map(async (batch) => {
      // ≤10 per request; retry once for silently-dropped ASINs (reconcile by asin).
      for (let attempt = 0; attempt < 2; attempt++) {
        const missing = batch.filter((a) => !fetched.has(a));
        if (!missing.length) break;
        try {
          const json = await rapidGet(env, "/product-details", {
            asin: missing.join(","),
            country: "US",
            fields: "asin,product_information,book_author_name",
          });
          const data = json?.data;
          const arr = Array.isArray(data) ? data : data ? [data] : [];
          asinsCharged += arr.length;
          for (const p of arr) if (p?.asin) fetched.set(String(p.asin), p);
        } catch {
          break;
        }
      }
    }),
  );

  for (const [asin, d] of fetched) {
    const info = (d.product_information || {}) as Record<string, unknown>;
    const row: BsrRow = {
      author: d.book_author_name ? decodeEntities(d.book_author_name) : null,
      bsrInBooks: parseBsrInBooks(info),
      bsrStore: parseBsrStore(info),
      publisher: (info.Publisher as string) ?? null,
      pages: parsePages(info),
    };
    byAsin[asin] = row;
    await env.CACHE.put(bsrCacheKey(asin), JSON.stringify(row), {
      expirationTtl: BSR_TTL_SECONDS,
    });
  }

  return { byAsin, cacheHits, asinsCharged };
}
