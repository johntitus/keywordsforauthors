import type {
  BookFormatFilter,
  BsrResult,
  DeepDiveResult,
  ReverseAsinResult,
  SearchResult,
} from "@kfa/shared";

/**
 * Typed fetch wrapper. Shares request/response types with the Worker via
 * @kfa/shared - the whole point of the monorepo (TechStack.md). Auth is off for
 * now (no login), so no session header is sent.
 */
const BASE = import.meta.env.VITE_API_URL ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export const api = {
  search: (keyword: string) => post<SearchResult>("/api/search", { keyword }),

  deepDive: (keyword: string, format: BookFormatFilter = "all", limit = 20) =>
    post<DeepDiveResult>("/api/deep-dive", { keyword, format, limit }),

  deepDiveBsr: (asins: string[]) =>
    post<BsrResult>("/api/deep-dive/bsr", { asins }),

  reverseAsin: (asins: string[]) =>
    post<ReverseAsinResult>("/api/reverse-asin", { asins }),
};
