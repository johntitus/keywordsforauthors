import {
  LANGUAGE_CODE,
  LOCATION_CODE_US,
  REVERSE_ASIN_MAX_RANK,
  REVERSE_ASIN_MIN_VOLUME,
  SEARCH_DEPTH,
  SEARCH_LIMIT,
  type KeywordRow,
  type RankedKeyword,
} from "@kfa/shared";
import type { Env } from "./env.js";

/**
 * Thin DataForSEO client — powers SEARCH and REVERSE ASIN. (The DEEP DIVE moved
 * to RapidAPI on 2026-07-18; see rapidapi.ts.) Each method encodes a load-bearing
 * decision from ProjectBrief.md and returns TRIMMED data + the upstream `cost`
 * (always read the cost field, never estimate — brief §2). Response typing is
 * intentionally loose (`any`) at the boundary; we keep the few fields we need and
 * discard ~95% of the payload (brief §3.2).
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

// Titles occasionally carry HTML entities (&amp;, &#39;, …); decode so the client
// re-escapes once for display instead of showing the raw entity.
function decodeTitle(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function fetchRankedKeywords(
  env: Env,
  asin: string,
): Promise<{ keywords: RankedKeyword[]; title: string | null; imageUrl: string | null; costUsd: number }> {
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
  // Keep keyword / volume / rank / placement — discard the repeated product record.
  // A book can appear twice for one keyword (organic + sponsored); `type` keeps
  // those distinguishable instead of looking like duplicate rows.
  const keywords: RankedKeyword[] = items.map((it: any) => {
    const rawType = it.ranked_serp_element?.serp_item?.type;
    const type =
      rawType === "amazon_paid" ? "sponsored" : rawType === "amazon_serp" ? "organic" : "other";
    return {
      keyword: it.keyword_data?.keyword,
      searchVolume: it.keyword_data?.keyword_info?.search_volume ?? null,
      rankAbsolute: it.ranked_serp_element?.serp_item?.rank_absolute ?? 0,
      type,
    };
  });
  // The target book's title + cover come from serp_item, identical across keywords.
  const serpItems = items
    .map((it: any) => it.ranked_serp_element?.serp_item)
    .filter((si: any) => si);
  const rawTitle = serpItems.find((si: any) => typeof si.title === "string" && si.title.length > 0)?.title;
  const title = rawTitle ? decodeTitle(rawTitle) : null;
  const imageUrl =
    serpItems.find((si: any) => typeof si.image_url === "string" && si.image_url.length > 0)?.image_url ?? null;
  return { keywords, title, imageUrl, costUsd };
}
