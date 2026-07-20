import type { ReverseAsinResult } from "@kfa/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";

/**
 * Step 3 of the loop: the keywords a book actually ranks for. Arrives with a
 * batch of ASINs from Competitors (?asins=), or you type/paste your own as
 * chips. Each keyword hands back to Keyword Search (step 1), closing the cycle
 * with a sharper seed. The mandatory server-side filter (rank<20, volume>50) is
 * applied by the Worker.
 */

const ASIN_RE = /^[0-9A-Z]{10}$/;
const norm = (t: string) => t.trim().toUpperCase();
// Capped at 10 to bound the underlying API cost per run (billed a flat 1 credit).
const tokenize = (raw: string) =>
  [...new Set(raw.split(/[\s,]+/).map(norm).filter(Boolean))].slice(0, 10);

// --- One combined table, aggregated by keyword across all reversed ASINs ---
type RevSortKey = "keyword" | "searchVolume" | "avgRank" | "competitors";
type SortDir = 1 | -1;

type CombinedEntry = { asin: string; rankAbsolute: number; type: string };
type CombinedRow = {
  keyword: string;
  searchVolume: number | null;
  avgRank: number; // mean rank across the ASINs ranking for it (under the placement filter)
  competitors: number; // how many of the reversed ASINs rank for it
  types: string[]; // organic / sponsored present across those ASINs
  asins: string[];
  entries: CombinedEntry[]; // per-book detail (true rank + placement), for the expanded view
};

const REV_COLUMNS: { key: RevSortKey; label: string; num?: boolean; title?: string }[] = [
  { key: "keyword", label: "Keyword" },
  { key: "searchVolume", label: "Volume", num: true },
  { key: "avgRank", label: "Avg Rank", num: true },
  {
    key: "competitors",
    label: "Competitors",
    num: true,
    title: "How many of your reversed ASINs rank for this keyword",
  },
];
const REV_DEFAULT_DIR: Record<RevSortKey, SortDir> = { keyword: 1, searchVolume: -1, avgRank: 1, competitors: -1 };
const REV_DEFAULT_SORT = { key: "searchVolume" as RevSortKey, dir: -1 as SortDir };

// --- Numeric range filters (Filters dropdown). Each targets a CombinedRow field;
// a null bound is unset, and a row with no value fails any set bound. ---
type RangeKey = "searchVolume" | "avgRank" | "competitors";
const REV_FILTER_FIELDS: { key: RangeKey; label: string; chip: string; step?: string }[] = [
  { key: "searchVolume", label: "Volume", chip: "vol" },
  { key: "avgRank", label: "Avg rank", chip: "rank", step: "0.1" },
  { key: "competitors", label: "Competitors", chip: "competitors" },
];
type Range = { min: number | null; max: number | null };
type Ranges = Record<RangeKey, Range>;
type DraftRanges = Record<RangeKey, { min: string; max: string }>;
const EMPTY_RANGES: Ranges = {
  searchVolume: { min: null, max: null },
  avgRank: { min: null, max: null },
  competitors: { min: null, max: null },
};
const EMPTY_DRAFT: DraftRanges = {
  searchVolume: { min: "", max: "" },
  avgRank: { min: "", max: "" },
  competitors: { min: "", max: "" },
};
const rangeActive = (r: Range) => r.min != null || r.max != null;
const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
const rangeLabel = (chip: string, { min, max }: Range) =>
  min != null && max != null
    ? `${chip} ${fmtNum(min)}–${fmtNum(max)}`
    : min != null
      ? `${chip} ≥ ${fmtNum(min)}`
      : `${chip} ≤ ${fmtNum(max as number)}`;

// Fold every ASIN's ranked keywords into one row per keyword.
function buildCombined(
  results: ReverseAsinResult["results"],
  placement: "all" | "organic" | "sponsored",
): CombinedRow[] {
  const map = new Map<
    string,
    { volume: number | null; entries: CombinedEntry[]; asins: Set<string>; types: Set<string> }
  >();
  for (const r of results) {
    for (const k of r.keywords) {
      if (placement !== "all" && k.type !== placement) continue;
      let a = map.get(k.keyword);
      if (!a) {
        a = { volume: k.searchVolume, entries: [], asins: new Set(), types: new Set() };
        map.set(k.keyword, a);
      }
      a.entries.push({ asin: r.asin, rankAbsolute: k.rankAbsolute, type: k.type });
      a.asins.add(r.asin);
      a.types.add(k.type);
      if (a.volume == null) a.volume = k.searchVolume;
    }
  }
  return [...map.entries()].map(([keyword, a]) => ({
    keyword,
    searchVolume: a.volume,
    avgRank: a.entries.reduce((x, e) => x + e.rankAbsolute, 0) / a.entries.length,
    competitors: a.asins.size,
    types: [...a.types],
    asins: [...a.asins],
    entries: a.entries.slice().sort((x, y) => x.rankAbsolute - y.rankAbsolute),
  }));
}

function compareRev(a: CombinedRow, b: CombinedRow, key: RevSortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv != null) return 1; // nulls last
  if (bv == null && av != null) return -1;
  let base = 0;
  if (av != null && bv != null) {
    base = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  }
  base *= dir;
  // Tiebreak: more competitors, then higher volume, then keyword A→Z.
  const comp = b.competitors - a.competitors;
  const vol = (b.searchVolume ?? -1) - (a.searchVolume ?? -1);
  return base !== 0 ? base : comp !== 0 ? comp : vol !== 0 ? vol : a.keyword.localeCompare(b.keyword);
}

function PlacementPill({ type }: { type: string }) {
  if (type === "sponsored")
    return (
      <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-mono text-[10px] text-red-600">
        sponsored
      </span>
    );
  if (type === "organic")
    return (
      <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] text-emerald-700">
        organic
      </span>
    );
  return <span className="font-mono text-[10px] text-muted/60">{type}</span>;
}

export function ReverseAsinPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [chips, setChips] = useState<string[]>(() => tokenize(params.get("asins") ?? ""));
  const [draft, setDraft] = useState("");
  const [placement, setPlacement] = useState<"all" | "organic" | "sponsored">("all");
  // Draft placement — only committed on Apply (matches the Competitors format filter).
  const [draftPlacement, setDraftPlacement] = useState<"all" | "organic" | "sponsored">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Ranges>(EMPTY_RANGES);
  const [draftFilters, setDraftFilters] = useState<DraftRanges>(EMPTY_DRAFT);
  const [sort, setSort] = useState(REV_DEFAULT_SORT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // The URL's ?asins= is the single source of truth for what's fetched. Submitting
  // pushes the chips into the URL, which drives this query — so a refresh (or a
  // deep link) fetches exactly the same thing, with no imperative effect to hang.
  const queryAsins = useMemo(
    () => tokenize(params.get("asins") ?? "").filter((a) => ASIN_RE.test(a)),
    [params],
  );
  const queryClient = useQueryClient();
  const reverse = useQuery({
    queryKey: ["reverse-asin", queryAsins.join(",")],
    queryFn: () => api.reverseAsin(queryAsins),
    enabled: queryAsins.length > 0,
    staleTime: Infinity,
  });

  // Reset the default sort (volume desc) and collapse rows on each new result.
  useEffect(() => {
    if (reverse.data) {
      setSort(REV_DEFAULT_SORT);
      setExpanded(new Set());
      setFilters(EMPTY_RANGES);
      setDraftFilters(EMPTY_DRAFT);
      setPlacement("all");
      setDraftPlacement("all");
      // A reverse-ASIN run spends a credit (flat 1 per action) — refresh the pill.
      queryClient.invalidateQueries({ queryKey: ["credits"] });
    }
  }, [reverse.data, queryClient]);

  const toggleExpanded = (keyword: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(keyword) ? next.delete(keyword) : next.add(keyword);
      return next;
    });

  const toggleSort = (key: RevSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as SortDir } : { key, dir: REV_DEFAULT_DIR[key] }));

  // `combined` = placement-filtered rows; `filtered` also applies the numeric ranges.
  const combined = reverse.data ? buildCombined(reverse.data.results, placement) : [];
  const hasRangeFilters = REV_FILTER_FIELDS.some((f) => rangeActive(filters[f.key]));
  const filtered = hasRangeFilters
    ? combined.filter((row) =>
        REV_FILTER_FIELDS.every(({ key }) => {
          const { min, max } = filters[key];
          if (min == null && max == null) return true;
          const v = row[key];
          if (v == null) return false;
          return (min == null || v >= min) && (max == null || v <= max);
        }),
      )
    : combined;
  const sortedCombined = [...filtered].sort((a, b) => compareRev(a, b, sort.key, sort.dir));
  const activeFilterCount =
    REV_FILTER_FIELDS.filter((f) => rangeActive(filters[f.key])).length + (placement !== "all" ? 1 : 0);
  const titleByAsin = new Map((reverse.data?.results ?? []).map((r) => [r.asin, r.title] as const));
  const imageByAsin = new Map((reverse.data?.results ?? []).map((r) => [r.asin, r.imageUrl] as const));

  const applyFilters = () => {
    const parse = (s: string) => {
      const n = Number(s.replace(/[^0-9.]/g, ""));
      return s.trim() && Number.isFinite(n) ? n : null;
    };
    setFilters(
      Object.fromEntries(
        REV_FILTER_FIELDS.map(({ key }) => [
          key,
          { min: parse(draftFilters[key].min), max: parse(draftFilters[key].max) },
        ]),
      ) as Ranges,
    );
    setPlacement(draftPlacement);
    setFiltersOpen(false);
  };
  const clearFilters = () => {
    setFilters(EMPTY_RANGES);
    setDraftFilters(EMPTY_DRAFT);
    setPlacement("all");
    setDraftPlacement("all");
    setFiltersOpen(false);
  };
  // Sync the draft to what's applied when opening (so the select reflects reality).
  const openFilters = () => {
    setDraftPlacement(placement);
    setFiltersOpen((o) => !o);
  };
  const clearRange = (key: RangeKey) => {
    setFilters((f) => ({ ...f, [key]: { min: null, max: null } }));
    setDraftFilters((d) => ({ ...d, [key]: { min: "", max: "" } }));
  };

  // Export the filtered + sorted keywords, one row per keyword (mirrors the collapsed
  // table). Placement column lists the placements present across the ranking books.
  const exportCsv = () => {
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Keyword", "Volume", "Avg Rank", "Competitors", "Placement"];
    const rowsOut = sortedCombined.map((row) => [
      row.keyword,
      row.searchVolume ?? "",
      Number.isInteger(row.avgRank) ? row.avgRank : Math.round(row.avgRank * 10) / 10,
      row.competitors,
      row.types.join(" / "),
    ]);
    if (!rowsOut.length) return;
    const csv = [header, ...rowsOut].map((r) => r.map(esc).join(",")).join("\r\n");
    // BOM so Excel reads UTF-8 (accents, curly quotes) correctly.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reverse-asin-keywords.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const addTokens = (raw: string) =>
    setChips((prev) => {
      const next = [...prev];
      for (const tok of raw.split(/[\s,]+/).map(norm).filter(Boolean)) {
        if (!next.includes(tok) && next.length < 10) next.push(tok);
      }
      return next;
    });

  const commitDraft = () => {
    if (draft.trim()) addTokens(draft);
    setDraft("");
  };

  const validChips = chips.filter((a) => ASIN_RE.test(a));

  // Submit = commit any draft, then write the valid ASINs to the URL. The query
  // above reacts to the URL change and fetches. Same-ASINs resubmit is a cheap
  // cache hit.
  const submit = () => {
    const all = tokenize([...chips, draft].join(" "));
    setChips(all);
    setDraft("");
    const valid = all.filter((a) => ASIN_RE.test(a));
    if (valid.length) setParams({ asins: valid.join(",") }, { replace: true });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === "Enter") {
      // Enter always runs the search (submit() folds any in-progress draft into
      // the ASIN set first). Use comma/space/tab to chip without searching.
      e.preventDefault();
      submit();
    } else if (k === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        commitDraft();
      }
    } else if (k === " " || k === ",") {
      e.preventDefault();
      if (draft.trim()) commitDraft();
    } else if (k === "Backspace" && !draft && chips.length) {
      e.preventDefault();
      setChips((prev) => prev.slice(0, -1));
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const tokens = text.split(/[\s,]+/).map(norm).filter(Boolean);
    // Chip on paste when it's multiple tokens, OR a single token that looks like
    // an ASIN. Anything else (a stray word) falls through to a normal paste so
    // the user can keep editing it in the draft.
    if (/[\s,]/.test(text) || (tokens.length === 1 && ASIN_RE.test(tokens[0]!))) {
      e.preventDefault();
      addTokens(`${draft} ${text}`);
      setDraft("");
    }
  };

  return (
    <section>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Reverse ASIN</h1>
      <p className="mt-2 text-lg leading-relaxed text-muted">
        The keywords a book actually ranks for. Type or paste ASINs.
      </p>

      <form
        className="mt-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 focus-within:border-clay"
          onClick={() => inputRef.current?.focus()}
        >
          {chips.map((asin) => {
            const invalid = !ASIN_RE.test(asin);
            return (
              <span
                key={asin}
                title={invalid ? "Not a valid ASIN (needs 10 letters or digits)" : undefined}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-xs ${
                  invalid
                    ? "border-red-300 bg-red-50 text-red-600"
                    : "border-clay/25 bg-clay-tint text-clay-dark"
                }`}
              >
                {asin}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setChips((prev) => prev.filter((a) => a !== asin));
                  }}
                  className="leading-none opacity-60 hover:opacity-100"
                  aria-label={`Remove ${asin}`}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            className="min-w-[120px] flex-1 border-0 bg-transparent font-mono text-[15px] text-ink outline-none placeholder:text-muted/50"
            placeholder={chips.length ? "" : "B00R92CL5E  B0ABCD1234"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={commitDraft}
          />
        </div>
        <button
          type="submit"
          disabled={reverse.isFetching || validChips.length === 0}
          className="rounded-lg bg-clay px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-clay-dark disabled:opacity-50"
        >
          {reverse.isFetching
            ? "Fetching…"
            : `Reverse ${validChips.length || ""} ASIN${validChips.length === 1 ? "" : "s"}`}
        </button>
      </form>
      <p className="mt-3 font-mono text-sm text-muted">
        Press comma, space, or tab after each ASIN; enter runs the search. One credit per search.
      </p>

      {reverse.isError && (
        <p className="mt-4 text-sm text-clay-dark">{(reverse.error as Error).message}</p>
      )}

      {reverse.data && (
        <div className="mt-8">
          <div className="rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
            <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 font-mono text-xs text-muted">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {hasRangeFilters
                    ? `${sortedCombined.length} of ${combined.length} keyword${combined.length === 1 ? "" : "s"}`
                    : `${combined.length} keyword${combined.length === 1 ? "" : "s"}`}{" "}
                  across {reverse.data.results.length} ASIN{reverse.data.results.length === 1 ? "" : "s"}
                </span>
                {placement !== "all" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-clay/25 bg-clay-tint px-2 py-0.5 capitalize text-clay-dark">
                    {placement}
                    <button
                      type="button"
                      aria-label="Clear placement filter"
                      onClick={() => {
                        setPlacement("all");
                        setDraftPlacement("all");
                      }}
                      className="leading-none opacity-60 hover:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                )}
                {REV_FILTER_FIELDS.filter((f) => rangeActive(filters[f.key])).map((f) => (
                  <span
                    key={f.key}
                    className="inline-flex items-center gap-1 rounded-full border border-clay/25 bg-clay-tint px-2 py-0.5 text-clay-dark"
                  >
                    {rangeLabel(f.chip, filters[f.key])}
                    <button
                      type="button"
                      aria-label={`Clear ${f.chip} filter`}
                      onClick={() => clearRange(f.key)}
                      className="leading-none opacity-60 hover:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={openFilters}
                    className="flex items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-black/5"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
                    </svg>
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="ml-0.5 rounded-full bg-clay px-1.5 text-[10px] font-semibold leading-4 text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                  {filtersOpen && (
                    <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-black/10 bg-white p-4 text-ink shadow-[0_12px_40px_-12px_rgba(44,39,35,0.25)]">
                      <div className="font-mono text-[11px] uppercase tracking-widest text-muted/70">Placement</div>
                      <select
                        className="mt-2 w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-clay"
                        value={draftPlacement}
                        onChange={(e) => setDraftPlacement(e.target.value as "all" | "organic" | "sponsored")}
                      >
                        <option value="all">All placements</option>
                        <option value="organic">Organic</option>
                        <option value="sponsored">Sponsored</option>
                      </select>
                      <div className="mt-4 space-y-3">
                        {REV_FILTER_FIELDS.map((f) => (
                          <div key={f.key}>
                            <div className="text-[10px] uppercase tracking-wide text-muted">{f.label}</div>
                            <div className="mt-1 flex items-center gap-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step={f.step}
                                placeholder="min"
                                value={draftFilters[f.key].min}
                                onChange={(e) =>
                                  setDraftFilters((d) => ({ ...d, [f.key]: { ...d[f.key], min: e.target.value } }))
                                }
                                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                                className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-clay"
                              />
                              <span className="text-muted">–</span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step={f.step}
                                placeholder="max"
                                value={draftFilters[f.key].max}
                                onChange={(e) =>
                                  setDraftFilters((d) => ({ ...d, [f.key]: { ...d[f.key], max: e.target.value } }))
                                }
                                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                                className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-clay"
                              />
                            </div>
                          </div>
                        ))}
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                  </svg>
                  Export to CSV
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-b-2xl">
            {sortedCombined.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">
                {combined.length === 0
                  ? `No ${placement === "all" ? "" : `${placement} `}ranking keywords for these ASINs.`
                  : "No keywords match the current filters."}
              </p>
            ) : (
              <table className="w-full text-[15px]">
                <thead className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
                  <tr>
                    <th className="w-8 px-2 py-2.5" />
                    {REV_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        title={col.title}
                        onClick={() => toggleSort(col.key)}
                        className={`cursor-pointer select-none px-4 py-2.5 font-medium transition-colors hover:text-ink ${
                          col.num ? "text-right" : ""
                        } ${sort.key === col.key ? "text-clay-dark" : ""}`}
                      >
                        {col.label}
                        <span className="ml-1">{sort.key === col.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
                      </th>
                    ))}
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {sortedCombined.map((row) => {
                    const isOpen = expanded.has(row.keyword);
                    const extraTypes = row.types.filter((t) => t !== "organic" && t !== "sponsored");
                    return (
                      <Fragment key={row.keyword}>
                        <tr
                          onClick={() => toggleExpanded(row.keyword)}
                          className="cursor-pointer border-t border-black/5 hover:bg-warm/40"
                        >
                          <td className="px-2 py-3 text-center font-mono text-muted">
                            <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                          </td>
                          <td className="px-4 py-3 text-ink">{row.keyword}</td>
                          <td className="px-4 py-3 text-right font-mono text-muted">
                            {row.searchVolume?.toLocaleString() ?? "-"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-muted">
                            {row.avgRank % 1 === 0 ? row.avgRank : row.avgRank.toFixed(1)}
                          </td>
                          <td
                            className="px-4 py-3 text-right font-mono text-ink"
                            title={`Ranking ASINs: ${row.asins.join(", ")}`}
                          >
                            {row.competitors}
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex flex-wrap gap-1">
                              {row.types.includes("organic") && <PlacementPill type="organic" />}
                              {row.types.includes("sponsored") && <PlacementPill type="sponsored" />}
                              {extraTypes.map((t) => (
                                <PlacementPill key={t} type={t} />
                              ))}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/search?seed=${encodeURIComponent(row.keyword)}`);
                              }}
                              className="whitespace-nowrap rounded-full border border-clay/25 bg-clay-tint px-3 py-1 font-mono text-xs text-clay-dark transition-colors hover:bg-clay hover:text-white"
                            >
                              Search →
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-black/5 bg-warm/20">
                            <td />
                            <td colSpan={6} className="px-4 pb-4 pt-1">
                              <table className="w-full max-w-2xl text-[13px]">
                                <thead className="text-left font-mono text-[10px] uppercase tracking-widest text-muted/60">
                                  <tr>
                                    <th className="py-1.5 pr-4 font-medium">Book</th>
                                    <th className="py-1.5 pr-4 font-medium">Placement</th>
                                    <th className="py-1.5 text-right font-medium">Rank</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.entries.map((e, i) => (
                                    <tr key={`${e.asin}-${e.type}-${i}`} className="border-t border-black/5">
                                      <td className="py-1.5 pr-4">
                                        <div className="flex items-center gap-2.5">
                                          {imageByAsin.get(e.asin) ? (
                                            <img
                                              src={imageByAsin.get(e.asin)!}
                                              alt=""
                                              loading="lazy"
                                              className="h-10 w-auto shrink-0 rounded shadow-sm"
                                            />
                                          ) : null}
                                          <div className="min-w-0">
                                            <a
                                              href={`https://www.amazon.com/dp/${e.asin}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-ink hover:text-clay-dark hover:underline"
                                            >
                                              {titleByAsin.get(e.asin) || e.asin}
                                            </a>
                                            <div className="font-mono text-[10px] text-muted/60">{e.asin}</div>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-1.5 pr-4 align-top">
                                        <PlacementPill type={e.type} />
                                      </td>
                                      <td className="py-1.5 text-right align-top font-mono text-muted">
                                        {e.rankAbsolute}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
