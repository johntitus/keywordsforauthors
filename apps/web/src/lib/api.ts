import type {
  AdminGrantResult,
  AdminMeResult,
  AdminUsersResult,
  BookFormatFilter,
  BsrResult,
  CreditBalance,
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

/** Error carrying the HTTP status + the API's error `code` (e.g. INSUFFICIENT_CREDITS). */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function authHeaders(base: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function throwApiError(res: Response): Promise<never> {
  const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  throw new ApiError(err.error ?? `Request failed (${res.status})`, res.status, err.code);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) return throwApiError(res);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() });
  if (!res.ok) return throwApiError(res);
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

  credits: () => get<CreditBalance>("/api/credits"),

  admin: {
    // 200 ⇒ the signed-in user is an admin; 403 (ApiError) ⇒ not.
    me: () => get<AdminMeResult>("/api/admin/me"),
    users: () => get<AdminUsersResult>("/api/admin/users"),
    grant: (userId: string, amount: number, reason?: string) =>
      post<AdminGrantResult>(`/api/admin/users/${encodeURIComponent(userId)}/grant`, {
        amount,
        ...(reason ? { reason } : {}),
      }),
  },
};
