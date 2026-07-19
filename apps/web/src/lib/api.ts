import type {
  BookFormatFilter,
  BsrResult,
  DeepDiveResult,
  KeywordSuggestResult,
  ReverseAsinResult,
  SearchResult,
} from "@kfa/shared";

/**
 * Typed fetch wrapper. Shares request/response types with the Worker via
 * @kfa/shared - the whole point of the monorepo (TechStack.md). When a user is
 * signed in, the Clerk session JWT is attached as a Bearer token (see lib/auth.ts);
 * signed-out requests still go through (server-side gating is deferred with credits).
 */
import { getAuthToken } from "./auth.js";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function authHeaders(base: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const api = {
  search: (keyword: string) => post<SearchResult>("/api/search", { keyword }),

  deepDive: (keyword: string, format: BookFormatFilter = "all", limit = 30) =>
    post<DeepDiveResult>("/api/deep-dive", { keyword, format, limit }),

  deepDiveBsr: (asins: string[]) =>
    post<BsrResult>("/api/deep-dive/bsr", { asins }),

  reverseAsin: (asins: string[]) =>
    post<ReverseAsinResult>("/api/reverse-asin", { asins }),

  suggestKeywords: (q: string) =>
    get<KeywordSuggestResult>(`/api/keywords/suggest?q=${encodeURIComponent(q)}`),
};
