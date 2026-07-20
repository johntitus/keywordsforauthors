import { RELEVANCE_ORDER, relevanceTier, type KeywordRow, type RelevanceTier } from '@kfa/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { KeywordAutosuggest } from '../components/KeywordAutosuggest.js';

/**
 * Step 1 of the loop (brief §1): seed keyword → the full path (related keywords +
 * the keywords the ranking competitor books own), merged into one list. Each row
 * hands off to a deep dive (step 2). A `?seed=` param (set by the reverse-ASIN
 * step) auto-runs the search so the loop closes without retyping.
 */

type SortKey = 'keyword' | 'searchVolume' | 'relevance';
type SortDir = 1 | -1; // 1 = ascending, -1 = descending

// Direction a column jumps to when you first click it (before toggling).
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  keyword: 1,
  searchVolume: -1,
  relevance: -1, // High → Low
};
const DEFAULT_SORT = { key: 'relevance' as SortKey, dir: -1 as SortDir };

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'keyword', label: 'Keyword' },
  { key: 'searchVolume', label: 'Volume' },
  {
    key: 'relevance',
    label: 'Relevance',
    title:
      "How on-topic the keyword is. Related keywords tier off how close they sit in Amazon's keyword graph; keywords found only through competing books tier off how many of those books rank for them.",
  },
];

// The per-row value each sort key compares on.
function sortValue(row: KeywordRow, key: SortKey): string | number | null {
  if (key === 'relevance') return RELEVANCE_ORDER[relevanceTier(row)];
  if (key === 'searchVolume') return row.searchVolume;
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
    base =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
  }
  base *= dir;
  if (base !== 0) return base;
  // Tiebreak: higher volume first, then keyword A→Z — keeps same-tier rows useful.
  const vol = (b.searchVolume ?? -1) - (a.searchVolume ?? -1);
  return vol !== 0 ? vol : a.keyword.localeCompare(b.keyword);
}

const TIER_PILL: Record<RelevanceTier, string> = {
  High: 'border-clay/25 bg-clay-tint text-clay-dark',
  Medium: 'border-black/10 bg-warm text-ink',
  Low: 'border-black/5 bg-transparent text-muted',
};

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [seed, setSeed] = useState(params.get('seed') ?? '');
  const [sort, setSort] = useState(DEFAULT_SORT);
  // Volume filters: null = unset. `filters` is what's applied; `draftFilters` is the
  // panel's working copy (only committed on Apply).
  const [filters, setFilters] = useState<{ min: number | null; max: number | null }>({
    min: null,
    max: null,
  });
  const [draftFilters, setDraftFilters] = useState<{ min: string; max: string }>({
    min: '',
    max: '',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const queryClient = useQueryClient();
  const search = useMutation({
    mutationFn: (kw: string) => api.search(kw),
    // A search spends a credit — refresh the nav balance pill.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credits'] }),
  });

  // Reset sort + filters whenever a new result arrives.
  useEffect(() => {
    if (search.data) {
      setSort(DEFAULT_SORT);
      setFilters({ min: null, max: null });
      setDraftFilters({ min: '', max: '' });
      setFiltersOpen(false);
    }
  }, [search.data]);

  const sortedKeywords = useMemo(() => {
    if (!search.data) return [];
    const sorted = [...search.data.keywords].sort((a, b) => compareRows(a, b, sort.key, sort.dir));
    if (filters.min == null && filters.max == null) return sorted;
    // A volume filter is quantitative — rows with no known volume can't satisfy it.
    return sorted.filter((k) => {
      if (k.searchVolume == null) return false;
      if (filters.min != null && k.searchVolume < filters.min) return false;
      if (filters.max != null && k.searchVolume > filters.max) return false;
      return true;
    });
  }, [search.data, sort, filters]);

  const applyFilters = () => {
    const parse = (s: string) => {
      const n = Number(s.replace(/[^0-9]/g, ''));
      return s.trim() && Number.isFinite(n) ? n : null;
    };
    setFilters({ min: parse(draftFilters.min), max: parse(draftFilters.max) });
    setFiltersOpen(false);
  };
  const clearFilters = () => {
    setFilters({ min: null, max: null });
    setDraftFilters({ min: '', max: '' });
    setFiltersOpen(false);
  };
  const hasFilters = filters.min != null || filters.max != null;

  // Export exactly what's on screen: the filtered + sorted rows, same three columns.
  const exportCsv = () => {
    if (!sortedKeywords.length) return;
    const esc = (v: string | number | null) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Keyword', 'Volume', 'Relevance'];
    const rows = sortedKeywords.map((k) => [k.keyword, k.searchVolume ?? '', relevanceTier(k)]);
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    // Prepend a BOM so Excel opens UTF-8 keywords (accents, curly quotes) correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const slug = (search.data?.seed ?? 'keywords')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'keywords'}-keywords.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: (s.dir * -1) as SortDir } : { key, dir: DEFAULT_DIR[key] },
    );

  // Auto-run when arriving with ?seed= (from Reverse ASIN → Search handoff).
  useEffect(() => {
    const incoming = params.get('seed');
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
        US search volume.
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
          className="min-w-[9rem] rounded-lg bg-clay px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-clay-dark disabled:opacity-50"
        >
          {search.isPending ? 'Searching…' : 'Search'}
        </button>
      </form>
      <p className="mt-3 font-mono text-sm text-muted">
        Tip: seed book-native language like “… workbook”, “… journal”, “… for kids”.
      </p>

      {search.isError && (
        <p className="mt-4 text-sm text-clay-dark">{(search.error as Error).message}</p>
      )}

      {search.data && search.data.keywords.length === 0 && (
        <p className="mt-6 font-mono text-sm text-muted">
          No related keywords and no competing books — “{search.data.seed}” looks genuinely empty.
        </p>
      )}

      {search.data && search.data.keywords.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
          <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 font-mono text-xs text-muted">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {sortedKeywords.length} related keyword{sortedKeywords.length === 1 ? '' : 's'}
                {hasFilters ? ` of ${search.data.keywords.length}` : ' found'}
              </span>
              {filters.min != null && (
                <span className="inline-flex items-center gap-1 rounded-full border border-clay/25 bg-clay-tint px-2 py-0.5 text-clay-dark">
                  min vol {filters.min.toLocaleString()}
                  <button
                    type="button"
                    aria-label="Clear min volume"
                    onClick={() => {
                      setFilters((f) => ({ ...f, min: null }));
                      setDraftFilters((f) => ({ ...f, min: '' }));
                    }}
                    className="leading-none opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              )}
              {filters.max != null && (
                <span className="inline-flex items-center gap-1 rounded-full border border-clay/25 bg-clay-tint px-2 py-0.5 text-clay-dark">
                  max vol {filters.max.toLocaleString()}
                  <button
                    type="button"
                    aria-label="Clear max volume"
                    onClick={() => {
                      setFilters((f) => ({ ...f, max: null }));
                      setDraftFilters((f) => ({ ...f, max: '' }));
                    }}
                    className="leading-none opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-black/5"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
                  </svg>
                  Filters
                  {hasFilters && (
                    <span className="ml-0.5 rounded-full bg-clay px-1.5 text-[10px] font-semibold leading-4 text-white">
                      {(filters.min != null ? 1 : 0) + (filters.max != null ? 1 : 0)}
                    </span>
                  )}
                </button>
                {filtersOpen && (
                  <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-black/10 bg-white p-4 text-ink shadow-[0_12px_40px_-12px_rgba(44,39,35,0.25)]">
                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted/70">
                      Search volume
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <label className="flex-1">
                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">
                          Min
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          placeholder="0"
                          value={draftFilters.min}
                          onChange={(e) => setDraftFilters((f) => ({ ...f, min: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                          className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-clay"
                        />
                      </label>
                      <label className="flex-1">
                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">
                          Max
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          placeholder="∞"
                          value={draftFilters.max}
                          onChange={(e) => setDraftFilters((f) => ({ ...f, max: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                          className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-clay"
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="text-xs text-muted transition-colors hover:text-ink"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={applyFilters}
                        className="rounded-lg bg-clay px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-clay-dark"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                title="Export to CSV"
                aria-label="Export to CSV"
                onClick={exportCsv}
                className="flex items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-black/5"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                </svg>
                Export to CSV
              </button>
            </div>
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
                      i === 0 ? '' : 'text-right'
                    } ${sort.key === col.key ? 'text-clay-dark' : ''}`}
                  >
                    {col.label}
                    <span className="ml-1">
                      {sort.key === col.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </span>
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
                    {k.searchVolume?.toLocaleString() ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      const tier = relevanceTier(k);
                      return (
                        <span
                          title={
                            k.source === 'reverse-asin'
                              ? `${k.competitorsRanking ?? 0} competing book(s) · best rank ${
                                  k.bestCompetitorRank ?? '—'
                                } · vol ${k.searchVolume ?? '—'}`
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
                      onClick={() =>
                        navigate(`/competitors?keyword=${encodeURIComponent(k.keyword)}`)
                      }
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
