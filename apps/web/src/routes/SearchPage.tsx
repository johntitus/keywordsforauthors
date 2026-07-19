import { RELEVANCE_ORDER, relevanceTier, type KeywordRow, type RelevanceTier } from "@kfa/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { KeywordAutosuggest } from "../components/KeywordAutosuggest.js";

/**
 * Step 1 of the loop (brief §1): seed keyword → the full path (related keywords +
 * the keywords the ranking competitor books own), merged into one list. Each row
 * hands off to a deep dive (step 2). A `?seed=` param (set by the reverse-ASIN
 * step) auto-runs the search so the loop closes without retyping.
 */

type SortKey = "keyword" | "searchVolume" | "relevance";
type SortDir = 1 | -1; // 1 = ascending, -1 = descending

// Direction a column jumps to when you first click it (before toggling).
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  keyword: 1,
  searchVolume: -1,
  relevance: -1, // High → Low
};
const DEFAULT_SORT = { key: "relevance" as SortKey, dir: -1 as SortDir };

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "keyword", label: "Keyword" },
  { key: "searchVolume", label: "Volume" },
  {
    key: "relevance",
    label: "Relevance",
    title:
      "How on-topic the keyword is. Related keywords tier off how close they sit in Amazon's keyword graph; keywords found only through competing books tier off how many of those books rank for them.",
  },
];

// The per-row value each sort key compares on.
function sortValue(row: KeywordRow, key: SortKey): string | number | null {
  if (key === "relevance") return RELEVANCE_ORDER[relevanceTier(row)];
  if (key === "searchVolume") return row.searchVolume;
  return row.keyword;
}

function compareRows(a: KeywordRow, b: KeywordRow, key: SortKey, dir: SortDir): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  // Nulls always sort last, regardless of direction.
  if (av == null && bv != null) return 1;
  if (bv == null && av != null) return -1;
  let base = 0;
  if (av != null && bv != null) {
    base = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  }
  base *= dir;
  if (base !== 0) return base;
  // Tiebreak: higher volume first, then keyword A→Z — keeps same-tier rows useful.
  const vol = (b.searchVolume ?? -1) - (a.searchVolume ?? -1);
  return vol !== 0 ? vol : a.keyword.localeCompare(b.keyword);
}

const TIER_PILL: Record<RelevanceTier, string> = {
  High: "border-clay/25 bg-clay-tint text-clay-dark",
  Medium: "border-black/10 bg-warm text-ink",
  Low: "border-black/5 bg-transparent text-muted",
};

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [seed, setSeed] = useState(params.get("seed") ?? "");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const search = useMutation({ mutationFn: (kw: string) => api.search(kw) });

  // Reset to the default sort (relevance, High first) whenever a new result arrives.
  useEffect(() => {
    if (search.data) setSort(DEFAULT_SORT);
  }, [search.data]);

  const sortedKeywords = useMemo(() => {
    if (!search.data) return [];
    return [...search.data.keywords].sort((a, b) => compareRows(a, b, sort.key, sort.dir));
  }, [search.data, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as SortDir } : { key, dir: DEFAULT_DIR[key] }));

  // Auto-run when arriving with ?seed= (from Reverse ASIN → Search handoff).
  useEffect(() => {
    const incoming = params.get("seed");
    if (incoming && incoming !== search.variables) {
      setSeed(incoming);
      search.mutate(incoming.toLowerCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const run = (kw: string) => {
    const v = kw.trim().toLowerCase();
    if (!v) return;
    setParams({ seed: v }, { replace: true });
    search.mutate(v);
  };

  return (
    <section>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Keyword Search</h1>
      <p className="mt-2 text-lg leading-relaxed text-muted">
        Start with a seed keyword. Get the related searches Amazon shows book buyers, each with its
        US search volume. Then deep-dive a promising one.
      </p>

      <form
        className="mt-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(seed);
        }}
      >
        <KeywordAutosuggest
          placeholder="stress management workbook"
          value={seed}
          onChange={setSeed}
          onPick={(kw) => {
            setSeed(kw);
            run(kw);
          }}
        />
        <button
          type="submit"
          disabled={search.isPending}
          className="rounded-lg bg-clay px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-clay-dark disabled:opacity-50"
        >
          {search.isPending ? "Searching…" : "Search"}
        </button>
      </form>
      <p className="mt-3 font-mono text-sm text-muted">
        Tip: seed book-native language like “… workbook”, “… journal”, “… for kids”.
      </p>

      {search.isError && (
        <p className="mt-4 text-sm text-clay-dark">{(search.error as Error).message}</p>
      )}

      {search.data && search.data.seedIndexedResults != null && (
        <div className="mt-6 inline-flex items-baseline gap-2 rounded-xl border border-black/5 bg-white px-4 py-3 shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
          <span className="font-display text-2xl font-bold tracking-tight text-ink">
            {search.data.seedIndexedResults.toLocaleString()}
          </span>
          <span className="font-mono text-xs text-muted">competitors</span>
        </div>
      )}

      {search.data && search.data.keywords.length === 0 && (
        <p className="mt-6 font-mono text-sm text-muted">
          No related keywords and no competing books — “{search.data.seed}” looks genuinely empty.
        </p>
      )}

      {search.data && search.data.keywords.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
          <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 font-mono text-xs text-muted">
            <span>
              US · Books · {search.data.keywords.length} keywords for “{search.data.seed}”
            </span>
            <span
              className={
                search.data.cached
                  ? "rounded-full border border-clay/25 bg-clay-tint px-2 py-0.5 text-clay-dark"
                  : "rounded-full border border-black/5 bg-warm px-2 py-0.5"
              }
            >
              {search.data.cached ? "cached" : "fresh"}
            </span>
          </div>
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
                {COLUMNS.map((col, i) => (
                  <th
                    key={col.key}
                    title={col.title}
                    onClick={() => toggleSort(col.key)}
                    className={`cursor-pointer select-none px-4 py-2.5 font-medium transition-colors hover:text-ink ${
                      i === 0 ? "" : "text-right"
                    } ${sort.key === col.key ? "text-clay-dark" : ""}`}
                  >
                    {col.label}
                    <span className="ml-1">{sort.key === col.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
                  </th>
                ))}
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {sortedKeywords.map((k) => (
                <tr key={k.keyword} className="group border-t border-black/5 hover:bg-warm/40">
                  <td className="px-4 py-3 text-ink">{k.keyword}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted">
                    {k.searchVolume?.toLocaleString() ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      const tier = relevanceTier(k);
                      return (
                        <span
                          title={
                            k.source === "reverse-asin"
                              ? `${k.competitorsRanking ?? 0} competing book(s) · best rank ${
                                  k.bestCompetitorRank ?? "—"
                                } · vol ${k.searchVolume ?? "—"}`
                              : `Graph depth ${k.depth}`
                          }
                          className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-xs ${TIER_PILL[tier]}`}
                        >
                          {tier}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => navigate(`/deep-dive?keyword=${encodeURIComponent(k.keyword)}`)}
                      className="whitespace-nowrap rounded-full border border-clay/25 bg-clay-tint px-3 py-1 font-mono text-xs text-clay-dark transition-colors hover:bg-clay hover:text-white"
                    >
                      Competitors →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
