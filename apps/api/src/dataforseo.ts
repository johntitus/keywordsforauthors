import {
  DEPARTMENT_BOOKS,
  LANGUAGE_CODE,
  LOCATION_CODE_US,
  REVERSE_ASIN_MAX_RANK,
  REVERSE_ASIN_MIN_VOLUME,
  SEARCH_DEPTH,
  SEARCH_LIMIT,
  SERP_ORGANIC_TYPE,
  type KeywordRow,
  type RankedKeyword,
} from "@kfa/shared";
import type { Env } from "./env.js";

/**
 * Thin DataForSEO client. Each method encodes a load-bearing decision from
 * ProjectBrief.md and returns TRIMMED data + the upstream `cost` (always read
 * the cost field, never estimate — brief §2). Response typing is intentionally
 * loose (`any`) at the boundary; we extract the few fields we keep and discard
 * ~95% of the payload (brief §3.2).
 *
 * NOTE: this is a scaffold. The HTTP calls are stubbed/marked TODO so the app
 * compiles and runs without live credentials; wire them up before launch.
 */

const BASE = "https://api.dataforseo.com/v3";

function authHeader(env: Env): string {
  const token = btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
  return `Basic ${token}`;
}

async function post(env: Env, path: string, task: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify([task]),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO ${path} -> ${res.status}`);
  }
  return res.json();
}

// ---------- SEARCH: related_keywords (brief §3.1) ----------

export async function fetchRelatedKeywords(
  env: Env,
  keyword: string,
): Promise<{ keywords: KeywordRow[]; costUsd: number }> {
  const task = {
    keyword,
    location_code: LOCATION_CODE_US,
    language_code: LANGUAGE_CODE,
    depth: SEARCH_DEPTH,
    limit: SEARCH_LIMIT,
    ignore_synonyms: true,
  };
  const json = await post(env, "/dataforseo_labs/amazon/related_keywords/live", task);
  const costUsd = json.cost ?? 0;
  const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
  const keywords: KeywordRow[] = items.map((it: any) => ({
    keyword: it.keyword_data?.keyword ?? it.keyword,
    searchVolume: it.keyword_data?.keyword_info?.search_volume ?? null,
    depth: it.depth ?? 0,
    lastUpdatedTime: it.keyword_data?.keyword_info?.last_updated_time ?? null,
  }));
  return { keywords, costUsd };
}

// ---------- REVERSE ASIN: ranked_keywords (brief §3.2) ----------
// The filters below are MANDATORY. Without them the endpoint returns garbage
// (a WiFi extender "ranks" for "baby girl"). `filters` is part of the cache key.

export async function fetchRankedKeywords(
  env: Env,
  asin: string,
): Promise<{ keywords: RankedKeyword[]; costUsd: number }> {
  const task = {
    asin,
    location_code: LOCATION_CODE_US,
    language_code: LANGUAGE_CODE,
    limit: 100,
    ignore_synonyms: true,
    filters: [
      ["ranked_serp_element.serp_item.rank_absolute", "<", REVERSE_ASIN_MAX_RANK],
      "and",
      ["keyword_data.keyword_info.search_volume", ">", REVERSE_ASIN_MIN_VOLUME],
    ],
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  };
  const json = await post(env, "/dataforseo_labs/amazon/ranked_keywords/live", task);
  const costUsd = json.cost ?? 0;
  const items = json.tasks?.[0]?.result?.[0]?.items ?? [];
  // Keep only keyword / volume / rank — discard the repeated product record.
  const keywords: RankedKeyword[] = items.map((it: any) => ({
    keyword: it.keyword_data?.keyword,
    searchVolume: it.keyword_data?.keyword_info?.search_volume ?? null,
    rankAbsolute: it.ranked_serp_element?.serp_item?.rank_absolute ?? 0,
  }));
  return { keywords, costUsd };
}

// ---------- DEEP DIVE: merchant/amazon/products (brief §3.3) ----------

export async function fetchBooksSerp(
  env: Env,
  keyword: string,
): Promise<{ items: any[]; seResultsCount: number | null; costUsd: number }> {
  const task = {
    keyword,
    department: DEPARTMENT_BOOKS,
    sort_by: "relevance",
    location_code: LOCATION_CODE_US,
    language_code: LANGUAGE_CODE,
  };
  const json = await post(env, "/merchant/amazon/products/live/advanced", task);
  const costUsd = json.cost ?? 0;
  const result = json.tasks?.[0]?.result?.[0];
  const all = result?.items ?? [];
  // Only organic book results count toward competition metrics (brief §3.3).
  const items = all.filter((it: any) => it.type === SERP_ORGANIC_TYPE);
  return { items, seResultsCount: result?.se_results_count ?? null, costUsd };
}
