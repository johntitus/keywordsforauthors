import type {
  DeepDiveResult,
  ReverseAsinResult,
  SearchResult,
} from "@kfa/shared";

/**
 * Typed fetch wrapper. Shares request/response types with the Worker via
 * @kfa/shared — the whole point of the monorepo (TechStack.md).
 */
const BASE = import.meta.env.VITE_API_URL ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Scaffold-only dev auth; replaced by the Clerk session token later.
      "X-Debug-User": "dev-user",
    },
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
  deepDive: (keyword: string) => post<DeepDiveResult>("/api/deep-dive", { keyword }),
  reverseAsin: (asins: string[]) =>
    post<ReverseAsinResult>("/api/reverse-asin", { asins }),
};
