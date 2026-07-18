// Standalone DataForSEO data-vetting tool. NOT part of the app — deliberately
// decoupled from Cloudflare (no KV/D1/Durable Objects/auth/credits) so you can
// eyeball real API data before committing to the full build.
//
//   node datavet/server.mjs      (or: npm run datavet)
//
// Credentials are read from apps/api/.dev.vars (gitignored) or the environment.
// Uses the same decided SEARCH params as packages/shared/src/constants.ts.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5050;

// --- Decided SEARCH params (mirror packages/shared/src/constants.ts) ---
const LOCATION_CODE_US = 2840;
const LANGUAGE_CODE = "en"; // Labs endpoints
const MERCHANT_LANGUAGE_CODE = "en_US"; // Merchant rejects "en" (40501)
const SEARCH_DEPTH = 3;
const SEARCH_LIMIT = 258;

// --- Load credentials (env first, then apps/api/.dev.vars) ---
// DataForSEO login/password + the RapidAPI key for real-time-amazon-data.
async function loadCreds() {
  let login = process.env.DATAFORSEO_LOGIN;
  let password = process.env.DATAFORSEO_PASSWORD;
  let rapidKey = process.env.RAPIDAPI_KEY;
  if (!login || !password || !rapidKey) {
    try {
      const raw = await readFile(join(__dirname, "../apps/api/.dev.vars"), "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*(\w+)\s*=\s*"?([^"]*)"?\s*$/);
        if (!m) continue;
        if (m[1] === "DATAFORSEO_LOGIN" && m[2]) login = m[2];
        if (m[1] === "DATAFORSEO_PASSWORD" && m[2]) password = m[2];
        if (m[1] === "RAPIDAPI_KEY" && m[2]) rapidKey = m[2];
      }
    } catch {
      /* file may not exist */
    }
  }
  return { login, password, rapidKey };
}

function authHeader(login, password) {
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

// --- SEARCH: dataforseo_labs/amazon/related_keywords/live ---
async function search(keyword, creds) {
  const task = {
    keyword: keyword.toLowerCase(),
    location_code: LOCATION_CODE_US,
    language_code: LANGUAGE_CODE,
    depth: SEARCH_DEPTH,
    limit: SEARCH_LIMIT,
    ignore_synonyms: true,
  };
  const res = await fetch(
    "https://api.dataforseo.com/v3/dataforseo_labs/amazon/related_keywords/live",
    {
      method: "POST",
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([task]),
    },
  );
  const json = await res.json();
  const task0 = json.tasks?.[0];
  const items = task0?.result?.[0]?.items ?? [];

  const keywords = items.map((it) => ({
    keyword: it.keyword_data?.keyword ?? it.keyword ?? null,
    searchVolume: it.keyword_data?.keyword_info?.search_volume ?? null,
    depth: it.depth ?? null,
    lastUpdatedTime: it.keyword_data?.keyword_info?.last_updated_time ?? null,
  }));
  // Default sort is rank_group; make it useful: volume desc, nulls last.
  keywords.sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1));

  return {
    seed: keyword,
    statusCode: json.status_code,
    statusMessage: json.status_message,
    taskStatusMessage: task0?.status_message ?? null,
    costUsd: json.cost ?? 0,
    count: keywords.length,
    keywords,
    raw: task0?.result?.[0] ?? json,
  };
}

// --- REVERSE ASIN: dataforseo_labs/amazon/ranked_keywords/live ---
// One ASIN per task; multiple ASINs batched as multiple tasks in one POST.
// The filter is deliberately adjustable here so you can vet the §10.1
// rank_absolute threshold — pass maxRank/minVolume, or 0 to drop that filter
// (unfiltered = see the "baby girl on a WiFi extender" garbage firsthand).
async function reverseAsin(asins, { maxRank, minVolume }, creds) {
  // NOTE: /live endpoints accept exactly ONE task per request ("You can set
  // only one task at a time"). So fire one request per ASIN, in parallel.
  // (The brief §3.2 "batch task objects in one POST" only applies to task_post.)
  const one = async (asin) => {
    const filters = [];
    if (maxRank) filters.push(["ranked_serp_element.serp_item.rank_absolute", "<", maxRank]);
    if (maxRank && minVolume) filters.push("and");
    if (minVolume) filters.push(["keyword_data.keyword_info.search_volume", ">", minVolume]);
    const task = {
      asin,
      location_code: LOCATION_CODE_US,
      language_code: LANGUAGE_CODE,
      limit: 100,
      ignore_synonyms: true,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
    };
    if (filters.length) task.filters = filters;

    try {
      const res = await fetch(
        "https://api.dataforseo.com/v3/dataforseo_labs/amazon/ranked_keywords/live",
        {
          method: "POST",
          headers: {
            Authorization: authHeader(creds.login, creds.password),
            "Content-Type": "application/json",
          },
          body: JSON.stringify([task]),
        },
      );
      const json = await res.json();
      const t = json.tasks?.[0];
      const r = t?.result?.[0];
      const items = r?.items ?? [];
      const keywords = items.map((it) => {
        const si = it.ranked_serp_element?.serp_item ?? {};
        const t = si.type === "amazon_paid" ? "sponsored" : si.type === "amazon_serp" ? "organic" : (si.type ?? null);
        return {
          keyword: it.keyword_data?.keyword ?? null,
          searchVolume: it.keyword_data?.keyword_info?.search_volume ?? null,
          rankAbsolute: si.rank_absolute ?? null,
          type: t, // organic (amazon_serp) vs sponsored (amazon_paid) placement
        };
      });
      return {
        asin,
        statusMessage: t?.status_message ?? json.status_message ?? null,
        totalCount: r?.total_count ?? null, // pre-limit count; big when unfiltered
        returned: keywords.length,
        keywords,
        cost: json.cost ?? 0,
        raw: t ?? json,
      };
    } catch (err) {
      return {
        asin,
        statusMessage: String(err?.message ?? err),
        totalCount: null,
        returned: 0,
        keywords: [],
        cost: 0,
        raw: null,
      };
    }
  };

  const settled = await Promise.all(asins.map(one));
  return {
    filter: { maxRank, minVolume },
    costUsd: settled.reduce((s, r) => s + (r.cost || 0), 0),
    statusMessage: "Ok.",
    results: settled.map(({ cost, raw, ...rest }) => rest),
    raw: settled.map((r) => r.raw),
  };
}

// DataForSEO deep dive removed 2026-07-18 — the deep dive now runs on RapidAPI
// (rapidSearch + rapidBsr below). DataForSEO still powers search + reverse-asin above.

// --- RAPIDAPI DEEP DIVE: real-time-amazon-data search + BSR enrichment ---
// The other lens on the same keyword: RapidAPI's own competitor set, enriched
// with the data DataForSEO can't give — BSR, publisher (indie/trad), page count.
// Encodes the findings in memory "bsr-via-rapidapi-hybrid":
//  - BSR is an unparsed string; only "#N in Books" is comparable across books.
//  - Product_Details batches (≤10) silently drop ASINs → reconcile + retry once.
//  - The server-side paperback filter is unreliable → also post-filter book_format.
const RAPIDAPI_HOST = "real-time-amazon-data.p.rapidapi.com";
const RAPIDAPI_PAPERBACK_BIN = "p_n_feature_browse-bin:2656022011";

function parsePrice(raw) {
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}
// RapidAPI titles arrive HTML-encoded (e.g. "Don&#x27;t Sweat"). Decode to real
// characters here so the client re-escapes once for display (no double-encoding).
function decodeEntities(s) {
  if (typeof s !== "string") return s;
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
function parseBsrInBooks(info) {
  const raw = info?.["Best Sellers Rank"];
  if (typeof raw !== "string") return null;
  const m = raw.match(/#([\d,]+)\s+in Books/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
// The store the FIRST rank is on ("in Books" / "Free in Kindle Store" / …) — so a
// non-Books rank is visibly flagged rather than silently compared as if it were one.
function parseBsrStore(info) {
  const raw = info?.["Best Sellers Rank"];
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^#[\d,]+\s+(.+?)\s*(?:\(|$)/);
  return m ? m[1].trim() : null;
}
function parsePages(info) {
  const raw = info?.["Print length"];
  if (typeof raw !== "string") return null;
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rapidGet(path, params, rapidKey) {
  const url = new URL("https://" + RAPIDAPI_HOST + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  // RapidAPI rate-limits bursts (~10 concurrent → 429). Retry 429 with backoff so
  // the enrichment pipeline is robust regardless of chunk size / concurrency.
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      headers: { "x-rapidapi-key": rapidKey, "x-rapidapi-host": RAPIDAPI_HOST },
    });
    if (res.status === 429 && attempt < 4) {
      await sleep(400 * (attempt + 1)); // 0.4s, 0.8s, 1.2s, 1.6s
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error("RapidAPI " + path + " -> " + res.status);
  // RapidAPI reports live plan quota in response headers. Billing is per ASIN
  // RETURNED (dropped ASINs are free) + 1 per search — verified via these counters.
  const remaining = Number(res.headers.get("x-ratelimit-requests-remaining"));
  const limit = Number(res.headers.get("x-ratelimit-requests-limit"));
  return {
    json: await res.json(),
    remaining: Number.isFinite(remaining) ? remaining : null,
    limit: Number.isFinite(limit) ? limit : null,
  };
}

// --- Per-ASIN BSR cache (in-memory; the real product would use Workers KV) ---
// Bestsellers and same-imprint titles recur across many keywords, so caching BSR
// per ASIN collapses real RapidAPI usage. Run the same keyword twice to watch the
// second dive report mostly cache hits and near-zero ASIN fetches.
const bsrCache = new Map(); // asin -> { at:ms, bsr:{bsrInBooks,bsrStore,publisher,pages} }
const BSR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (BSR drifts daily; tune later)

function bsrCacheGet(asin) {
  const e = bsrCache.get(asin);
  if (!e) return null;
  if (Date.now() - e.at > BSR_TTL_MS) {
    bsrCache.delete(asin);
    return null;
  }
  return e.bsr;
}

// --- RAPIDAPI deep dive, split for progressive rendering ---
// Phase 1: rapidSearch — one /search call, fast, returns the competitor table with
// cover images (no BSR yet). Phase 2: rapidBsr — per-ASIN BSR/publisher/pages, cache
// first then fetch misses. The UI renders phase 1 immediately and fills BSR when
// phase 2 returns. Billing (verified): search = 1 unit; product-details = 1 per ASIN
// RETURNED (drops free). See memory "bsr-via-rapidapi-hybrid".
async function rapidSearch(keyword, format, limit, rapidKey) {
  const bin = format === "paperback" ? RAPIDAPI_PAPERBACK_BIN : undefined;
  const s = await rapidGet(
    "/search",
    { query: keyword.toLowerCase(), country: "US", page: 1, sort_by: "RELEVANCE", additional_filters: bin },
    rapidKey,
  );
  const search = s.json;
  const matchFmt = (f) => {
    if (format === "all") return true;
    const t = String(f || "").toLowerCase();
    if (format === "paperback") return t.includes("paperback");
    if (format === "ebook") return t.includes("kindle") || t.includes("ebook");
    return true;
  };
  const items = (search?.data?.products ?? [])
    .filter((p) => matchFmt(p.book_format))
    .slice(0, limit)
    .map((p) => ({
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
      author: null, bsrInBooks: null, bsrStore: null, publisher: null, pages: null,
    }));
  return {
    keyword, format,
    returned: items.length,
    totalResults: search?.data?.total_products ?? null,
    searchCharged: 1,
    quotaRemaining: s.remaining,
    quotaLimit: s.limit,
    items,
    raw: search?.data ?? search,
  };
}

async function rapidBsr(asins, rapidKey) {
  let quotaLimit = null, quotaRemaining = null;
  const seeQuota = (o) => {
    if (o.limit != null) quotaLimit = o.limit;
    if (o.remaining != null) quotaRemaining = quotaRemaining == null ? o.remaining : Math.min(quotaRemaining, o.remaining);
  };
  const byAsin = {}; // asin -> parsed bsr fields (returned to client)
  const misses = [];
  for (const a of asins) {
    const hit = bsrCacheGet(a);
    if (hit) byAsin[a] = hit;
    else misses.push(a);
  }
  const cacheHits = asins.length - misses.length;

  const fetched = new Map();
  let detailHttpCalls = 0, asinRequests = 0, asinsCharged = 0;
  const batches = [];
  for (let i = 0; i < misses.length; i += 10) batches.push(misses.slice(i, i + 10));
  await Promise.all(
    batches.map(async (batch) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const missing = batch.filter((a) => !fetched.has(a));
        if (!missing.length) break;
        detailHttpCalls++;
        asinRequests += missing.length;
        try {
          const r = await rapidGet(
            "/product-details",
            { asin: missing.join(","), country: "US", fields: "asin,product_information,book_author_name" },
            rapidKey,
          );
          seeQuota(r);
          const data = r.json?.data;
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
    const info = d.product_information || {};
    const bsr = {
      author: d.book_author_name ? decodeEntities(d.book_author_name) : null,
      bsrInBooks: parseBsrInBooks(info),
      bsrStore: parseBsrStore(info),
      publisher: info.Publisher ?? null,
      pages: parsePages(info),
    };
    byAsin[asin] = bsr;
    bsrCache.set(asin, { at: Date.now(), bsr });
  }
  return {
    byAsin,
    requested: asins.length,
    cacheHits,
    asinRequests,
    asinsCharged, // ASINs returned = real per-ASIN quota billed
    detailHttpCalls,
    quotaThisCall: asinsCharged, // detail-only (search counted separately in phase 1)
    quotaRemaining,
    quotaLimit,
    cacheSize: bsrCache.size,
  };
}

// --- HTTP server ---
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/") {
    const html = await readFile(join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (url.pathname === "/api/search") {
    const keyword = (url.searchParams.get("keyword") ?? "").trim();
    res.setHeader("Content-Type", "application/json");
    if (!keyword) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Missing keyword" }));
      return;
    }
    const creds = await loadCreds();
    if (!creds.login || !creds.password) {
      res.writeHead(400);
      res.end(
        JSON.stringify({
          error:
            "No DataForSEO credentials. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to apps/api/.dev.vars, then retry.",
        }),
      );
      return;
    }
    try {
      const result = await search(keyword, creds);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }

  if (url.pathname === "/api/reverse-asin") {
    res.setHeader("Content-Type", "application/json");
    const asins = (url.searchParams.get("asins") ?? "")
      .split(/[\s,]+/)
      .map((a) => a.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 10);
    if (!asins.length) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Enter at least one ASIN" }));
      return;
    }
    // 0 / empty => drop that half of the filter.
    const maxRank = Number(url.searchParams.get("maxRank") ?? 20) || 0;
    const minVolume = Number(url.searchParams.get("minVolume") ?? 50) || 0;
    const creds = await loadCreds();
    if (!creds.login || !creds.password) {
      res.writeHead(400);
      res.end(
        JSON.stringify({
          error:
            "No DataForSEO credentials. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to apps/api/.dev.vars, then retry.",
        }),
      );
      return;
    }
    try {
      const result = await reverseAsin(asins, { maxRank, minVolume }, creds);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }

  if (url.pathname === "/api/rapid-search") {
    const keyword = (url.searchParams.get("keyword") ?? "").trim();
    const format = url.searchParams.get("format") ?? "all";
    res.setHeader("Content-Type", "application/json");
    if (!keyword) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing keyword" })); return; }
    const creds = await loadCreds();
    if (!creds.rapidKey) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "No RapidAPI key. Add RAPIDAPI_KEY (real-time-amazon-data) to apps/api/.dev.vars, then retry." }));
      return;
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 0, 1), 48);
    try {
      const result = await rapidSearch(keyword, format, limit, creds.rapidKey);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502); res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }

  if (url.pathname === "/api/rapid-bsr") {
    res.setHeader("Content-Type", "application/json");
    const asins = (url.searchParams.get("asins") ?? "").split(/[\s,]+/).map((a) => a.trim()).filter(Boolean).slice(0, 48);
    if (!asins.length) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing asins" })); return; }
    const creds = await loadCreds();
    if (!creds.rapidKey) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "No RapidAPI key. Add RAPIDAPI_KEY (real-time-amazon-data) to apps/api/.dev.vars, then retry." }));
      return;
    }
    try {
      const result = await rapidBsr(asins, creds.rapidKey);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502); res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`datavet running → http://127.0.0.1:${PORT}`);
});
