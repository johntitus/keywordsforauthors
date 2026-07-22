import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";

/**
 * Admin → Activity tab. "What are people searching for": a popular-keywords
 * aggregation over a selectable window (with an optional tool filter) plus a
 * recent-searches feed that can be scoped to one user via ?user=<id> (the link
 * from the Users tab). Both read the `search_events` log.
 */

const WINDOWS = [
  { days: 1, label: "24h" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];
const TOOLS = [
  { key: "all", label: "All" },
  { key: "search", label: "Search" },
  { key: "deep_dive", label: "Competitors" },
] as const;
type ToolKey = (typeof TOOLS)[number]["key"];

const toolLabel = (t: string) => (t === "deep_dive" ? "Competitors" : t === "search" ? "Search" : t);
const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function AdminActivityPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get("user") || undefined;
  const windowDays = Number(params.get("window")) || 7;
  const tool = (params.get("tool") as ToolKey) || "all";

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const popular = useQuery({
    queryKey: ["admin-popular", windowDays, tool],
    queryFn: () => api.admin.popular(windowDays, tool === "all" ? undefined : tool),
    retry: false,
  });
  const recent = useQuery({
    queryKey: ["admin-recent", userId ?? null],
    queryFn: () => api.admin.recent(userId),
    retry: false,
  });

  // Label for the user chip: prefer an email from the returned events, else the ID.
  const userLabel = useMemo(() => {
    if (!userId) return null;
    const withEmail = recent.data?.events.find((e) => e.email);
    return withEmail?.email || userId;
  }, [userId, recent.data]);

  return (
    <div className="space-y-10">
      {/* --- Popular keywords --- */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-ink">Popular keywords</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-black/10 bg-white p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w.days}
                  type="button"
                  onClick={() => setParam("window", String(w.days))}
                  className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors ${
                    windowDays === w.days ? "bg-clay text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-black/10 bg-white p-0.5">
              {TOOLS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setParam("tool", t.key === "all" ? null : t.key)}
                  className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors ${
                    tool === t.key ? "bg-clay text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {popular.isError && (
          <p className="mt-4 text-sm text-clay-dark">{(popular.error as Error).message}</p>
        )}
        <div className="mt-4 rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
          <table className="w-full text-[15px]">
            <thead className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
              <tr>
                <th className="px-4 py-2.5 font-medium">Keyword</th>
                <th className="px-4 py-2.5 text-right font-medium">Searches</th>
                <th className="px-4 py-2.5 text-right font-medium">Users</th>
              </tr>
            </thead>
            <tbody>
              {(popular.data?.keywords ?? []).map((k) => (
                <tr key={k.keyword} className="border-t border-black/5 hover:bg-warm/40">
                  <td className="px-4 py-2.5 text-ink">{k.keyword}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink">{k.count.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted">{k.users.toLocaleString()}</td>
                </tr>
              ))}
              {popular.isSuccess && popular.data.keywords.length === 0 && (
                <tr className="border-t border-black/5">
                  <td colSpan={3} className="px-4 py-6 text-center font-mono text-sm text-muted">
                    No searches in this window yet.
                  </td>
                </tr>
              )}
              {popular.isLoading && (
                <tr className="border-t border-black/5">
                  <td colSpan={3} className="px-4 py-6 text-center font-mono text-sm text-muted">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Recent activity --- */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-bold text-ink">Recent searches</h2>
          {userLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-clay/25 bg-clay-tint px-2.5 py-0.5 font-mono text-xs text-clay-dark">
              {userLabel}
              <button
                type="button"
                aria-label="Clear user filter"
                onClick={() => setParam("user", null)}
                className="leading-none opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </span>
          )}
        </div>

        {recent.isError && (
          <p className="mt-4 text-sm text-clay-dark">{(recent.error as Error).message}</p>
        )}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
          <table className="w-full min-w-[640px] text-[15px]">
            <thead className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Tool</th>
                <th className="px-4 py-2.5 font-medium">Keyword</th>
              </tr>
            </thead>
            <tbody>
              {(recent.data?.events ?? []).map((e) => (
                <tr key={e.id} className="border-t border-black/5 hover:bg-warm/40">
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{fmtWhen(e.createdAt)}</td>
                  <td className="px-4 py-2.5 text-ink">
                    {e.email || <span className="font-mono text-xs text-muted">{e.userId}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full border border-black/10 bg-warm px-2 py-0.5 font-mono text-[10px] text-muted">
                      {toolLabel(e.tool)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink">{e.keyword}</td>
                </tr>
              ))}
              {recent.isSuccess && recent.data.events.length === 0 && (
                <tr className="border-t border-black/5">
                  <td colSpan={4} className="px-4 py-6 text-center font-mono text-sm text-muted">
                    {userId ? "No searches from this user yet." : "No searches logged yet."}
                  </td>
                </tr>
              )}
              {recent.isLoading && (
                <tr className="border-t border-black/5">
                  <td colSpan={4} className="px-4 py-6 text-center font-mono text-sm text-muted">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
