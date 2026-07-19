import type { BookFormatFilter, SerpBook } from "@kfa/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { KeywordAutosuggest } from "../components/KeywordAutosuggest.js";

/**
 * Step 2 of the loop: who ranks P1 for a keyword, each competitor enriched with
 * BSR / author / publisher / pages (RapidAPI, 2026-07-18). Two phases: the table
 * renders fast (phase 1), then BSR columns fill progressively (phase 2). The
 * signature insight - SERP purity - is computed client-side from the BSR store.
 */

type Row = SerpBook & { pending: boolean };
// `bsrShown` is the rank actually displayed/sorted for the active result format
// (Books rank under all-formats; the store's own rank under a single format).
type DisplayRow = Row & { bsrShown: number | null };

// --- Sortable columns (default: BSR ascending — best sellers first) ---
// Author now lives under the title, so it's not its own column.
type DiveSortKey =
  | "title" | "asin" | "priceFrom" | "ratingValue" | "ratingVotes" | "bsrShown" | "publisher" | "pages";
type SortDir = 1 | -1;

const DIVE_COLUMNS: { key: DiveSortKey; label: string; num?: boolean }[] = [
  { key: "title", label: "Title" },
  { key: "asin", label: "ASIN" },
  { key: "priceFrom", label: "Price", num: true },
  { key: "ratingValue", label: "Rating", num: true },
  { key: "ratingVotes", label: "Reviews", num: true },
  { key: "bsrShown", label: "BSR", num: true }, // header suffix is set per result format
  { key: "publisher", label: "Publisher" },
  { key: "pages", label: "Pages", num: true },
];

// Human label for the active book format (for the header chip).
const formatLabel = (fmt: BookFormatFilter) =>
  fmt === "paperback" ? "Paperback" : fmt === "ebook" ? "eBook" : fmt === "audiobook" ? "Audiobook" : "All formats";

// All-formats mixes stores, so only the cross-comparable "in Books" rank is shown
// (others sort weird). A single format shares one store, so show that store's rank.
const effectiveBsr = (r: Row, fmt: BookFormatFilter) => (fmt === "all" ? r.bsrInBooks : r.bsrRank);

// Direction a column jumps to on first click. BSR/price ascending (lower = better/cheaper);
// rating/reviews/pages descending (more first); text A→Z.
const DIVE_DEFAULT_DIR: Record<DiveSortKey, SortDir> = {
  title: 1, asin: 1, publisher: 1,
  priceFrom: 1, ratingValue: -1, ratingVotes: -1, bsrShown: 1, pages: -1,
};
const DIVE_DEFAULT_SORT = { key: "bsrShown" as DiveSortKey, dir: 1 as SortDir };

function compareDive(a: DisplayRow, b: DisplayRow, key: DiveSortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  // Nulls always last (pending/blank rows sink), regardless of direction.
  if (av == null && bv != null) return 1;
  if (bv == null && av != null) return -1;
  let base = 0;
  if (av != null && bv != null) {
    base = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  }
  base *= dir;
  // Stable tiebreak: original relevance order (keeps rows from jostling while BSR fills).
  return base !== 0 ? base : a.order - b.order;
}

// Measured tuning: 3-ASIN batches fired concurrently balance first-paint vs total.
const BSR_CHUNK = 3;
const BSR_CONCURRENCY = 8;

// Audiobooks (Audible) carry no comparable Books BSR and no page count, so they
// get a plain format label instead of a rank in the BSR column.
const isAudiobook = (fmt: string | null) => /audiobook|audible/i.test(fmt || "");
// Kindle/ebook rows rank in the Kindle Store (or, like some, only in subcategories),
// never comparable to a Books BSR — so under all-formats they get a clean format
// label instead of a raw store/category string.
const isEbook = (fmt: string | null) => /kindle|ebook/i.test(fmt || "");
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function runPool(tasks: (() => Promise<void>)[], concurrency: number) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      if (task) await task();
    }
  });
  await Promise.all(workers);
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-clay/25 border-t-clay align-middle" />
  );
}

// --- Numeric range filters shown in the Filters dropdown. Each targets a display
// field; a bound of null is unset, and rows with a null value fail any set bound. ---
type RangeKey = "ratingValue" | "ratingVotes" | "priceFrom" | "bsrShown";
const FILTER_FIELDS: { key: RangeKey; label: string; chip: string; step?: string }[] = [
  { key: "priceFrom", label: "Price ($)", chip: "price", step: "0.01" },
  { key: "ratingValue", label: "Rating (★)", chip: "rating", step: "0.1" },
  { key: "ratingVotes", label: "Reviews", chip: "reviews" },
  { key: "bsrShown", label: "BSR", chip: "BSR" },
];
type Range = { min: number | null; max: number | null };
type Ranges = Record<RangeKey, Range>;
type DraftRange = { min: string; max: string };
type DraftRanges = Record<RangeKey, DraftRange>;
const EMPTY_RANGES: Ranges = {
  priceFrom: { min: null, max: null },
  ratingValue: { min: null, max: null },
  ratingVotes: { min: null, max: null },
  bsrShown: { min: null, max: null },
};
const EMPTY_DRAFT: DraftRanges = {
  priceFrom: { min: "", max: "" },
  ratingValue: { min: "", max: "" },
  ratingVotes: { min: "", max: "" },
  bsrShown: { min: "", max: "" },
};
const rangeActive = (r: Range) => r.min != null || r.max != null;
const fmtNum = (n: number) => n.toLocaleString();
const rangeLabel = (chip: string, { min, max }: Range) =>
  min != null && max != null
    ? `${chip} ${fmtNum(min)}–${fmtNum(max)}`
    : min != null
      ? `${chip} ≥ ${fmtNum(min)}`
      : `${chip} ≤ ${fmtNum(max as number)}`;

export function DeepDivePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState(params.get("keyword") ?? "");
  const [format, setFormat] = useState<BookFormatFilter>("all");
  // The format the CURRENT rows were fetched with — drives which BSR is shown.
  // (Distinct from `format`, which can change before the next search runs.)
  const [resultFormat, setResultFormat] = useState<BookFormatFilter>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "enriching" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sort, setSort] = useState(DIVE_DEFAULT_SORT);
  // ASINs the user has ticked to send to Reverse ASIN (capped at the tool's max of 10).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastRun = useRef<string | null>(null);

  const REVERSE_ASIN_MAX = 10;
  const toggleSelected = (asin: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else if (next.size < REVERSE_ASIN_MAX) next.add(asin);
      return next;
    });

  // Filters (numeric ranges) applied client-side; format is refetch-triggering so
  // it's committed via `format` and re-runs the dive on Apply.
  const [filters, setFilters] = useState<Ranges>(EMPTY_RANGES);
  const [draftFilters, setDraftFilters] = useState<DraftRanges>(EMPTY_DRAFT);
  const [draftFormat, setDraftFormat] = useState<BookFormatFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasFilters = FILTER_FIELDS.some((f) => rangeActive(filters[f.key]));

  // Resolve the displayed/sortable BSR for the format these rows were fetched with.
  const displayRows = useMemo<DisplayRow[]>(
    () => rows.map((r) => ({ ...r, bsrShown: effectiveBsr(r, resultFormat) })),
    [rows, resultFormat],
  );
  // Apply the numeric range filters. A row with no value for a bounded field fails.
  const filteredRows = useMemo(() => {
    if (!hasFilters) return displayRows;
    return displayRows.filter((r) =>
      FILTER_FIELDS.every(({ key }) => {
        const { min, max } = filters[key];
        if (min == null && max == null) return true;
        const v = r[key];
        if (v == null) return false;
        return (min == null || v >= min) && (max == null || v <= max);
      }),
    );
  }, [displayRows, filters, hasFilters]);
  // While BSR is still filling in, hold rows in their original relevance order so
  // the table fills in place instead of jumping around on each batch. Apply the
  // active sort only once enrichment is done.
  const sortedRows = useMemo(() => {
    if (status !== "done") return [...filteredRows].sort((a, b) => a.order - b.order);
    return [...filteredRows].sort((a, b) => compareDive(a, b, sort.key, sort.dir));
  }, [filteredRows, sort, status]);

  const applyFilters = () => {
    const parse = (s: string) => {
      const n = Number(s.replace(/[^0-9.]/g, ""));
      return s.trim() && Number.isFinite(n) ? n : null;
    };
    setFilters(
      Object.fromEntries(
        FILTER_FIELDS.map(({ key }) => [
          key,
          { min: parse(draftFilters[key].min), max: parse(draftFilters[key].max) },
        ]),
      ) as Ranges,
    );
    setFiltersOpen(false);
    // Format change means a different SERP — refetch (numeric filters still apply).
    if (draftFormat !== format) {
      setFormat(draftFormat);
      runDeepDive(keyword, draftFormat);
    }
  };
  const clearFilters = () => {
    setFilters(EMPTY_RANGES);
    setDraftFilters(EMPTY_DRAFT);
    setFiltersOpen(false);
  };
  const clearRange = (key: RangeKey) => {
    setFilters((f) => ({ ...f, [key]: { min: null, max: null } }));
    setDraftFilters((d) => ({ ...d, [key]: { min: "", max: "" } }));
  };
  const openFilters = () => {
    // Sync the draft to what's applied (incl. current format) when opening.
    setDraftFormat(format);
    setFiltersOpen((o) => !o);
  };
  const toggleSort = (key: DiveSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as SortDir } : { key, dir: DIVE_DEFAULT_DIR[key] }));

  async function runDeepDive(kw: string, fmt: BookFormatFilter) {
    const v = kw.trim().toLowerCase();
    if (!v) return;
    lastRun.current = v;
    setStatus("searching");
    setError("");
    setResultFormat(fmt);
    setRows([]);
    setTotalResults(null);
    setProgress({ done: 0, total: 0 });
    setSort(DIVE_DEFAULT_SORT);
    setSelected(new Set());
    try {
      // Phase 1 - search.
      const res = await api.deepDive(v, fmt, 30);
      const initial: Row[] = res.books.map((b) => ({ ...b, pending: true }));
      setRows(initial);
      setTotalResults(res.totalResults);
      if (!initial.length) {
        setStatus("done");
        return;
      }
      // Phase 2 - BSR enrichment, filled in place as each chunk returns.
      setStatus("enriching");
      setProgress({ done: 0, total: initial.length });
      const chunks = chunk(initial.map((r) => r.asin).filter(Boolean), BSR_CHUNK);
      const tasks = chunks.map((c) => async () => {
        try {
          const { byAsin } = await api.deepDiveBsr(c);
          setRows((prev) =>
            prev.map((r) =>
              c.includes(r.asin) ? { ...r, ...(byAsin[r.asin] ?? {}), pending: false } : r,
            ),
          );
        } catch {
          setRows((prev) => prev.map((r) => (c.includes(r.asin) ? { ...r, pending: false } : r)));
        } finally {
          setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + c.length) }));
        }
      });
      await runPool(tasks, BSR_CONCURRENCY);
      setStatus("done");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  // Auto-run on arrival with ?keyword= (from Search → Deep dive handoff).
  useEffect(() => {
    const incoming = params.get("keyword");
    if (incoming && incoming.toLowerCase() !== lastRun.current) {
      setKeyword(incoming);
      clearFilters();
      runDeepDive(incoming, format);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    clearFilters();
    setParams({ keyword: keyword.trim().toLowerCase() }, { replace: true });
    runDeepDive(keyword, format);
  };

  const sendToReverse = () => {
    const asins = [...selected].slice(0, REVERSE_ASIN_MAX);
    if (!asins.length) return;
    navigate(`/reverse-asin?asins=${encodeURIComponent(asins.join(","))}`);
  };

  // Export the filtered + sorted competitors, matching the on-screen columns.
  const exportCsv = () => {
    if (!sortedRows.length) return;
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Title", "Author", "ASIN", "Price", "Rating", "Reviews", "BSR", "Publisher", "Pages"];
    const rowsOut = sortedRows.map((r) => [
      r.title,
      r.author ?? "",
      r.asin,
      r.priceFrom ?? "",
      r.ratingValue ?? "",
      r.ratingVotes ?? "",
      r.bsrShown ?? "",
      r.publisher ?? "",
      r.pages ?? "",
    ]);
    const csv = [header, ...rowsOut].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const slug = (keyword || "competitors").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug || "competitors"}-competitors.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const busy = status === "searching" || status === "enriching";

  return (
    <section>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Competitors</h1>
      <p className="mt-2 max-w-2xl text-lg leading-relaxed text-muted">
        The books ranking on Amazon for a keyword.
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-3" onSubmit={submit}>
        <KeywordAutosuggest
          placeholder="gratitude journal"
          value={keyword}
          onChange={setKeyword}
          onPick={(kw) => {
            setKeyword(kw);
            clearFilters();
            setParams({ keyword: kw }, { replace: true });
            runDeepDive(kw, format);
          }}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-clay px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-clay-dark disabled:opacity-50"
        >
          {busy ? "Working…" : "Find competitors"}
        </button>
      </form>

      {status === "error" && <p className="mt-4 text-sm text-clay-dark">{error}</p>}

      {rows.length > 0 && (
        <>
          <div className="mt-8 rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
            <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 font-mono text-xs text-muted">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {hasFilters
                    ? `${sortedRows.length} of top ${rows.length} competitors`
                    : `Top ${rows.length} competitors`}
                  {totalResults != null &&
                    (hasFilters
                      ? ` · ${totalResults.toLocaleString()} on Amazon`
                      : ` of ${totalResults.toLocaleString()} on Amazon`)}
                </span>
                {resultFormat !== "all" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-clay/25 bg-clay-tint px-2 py-0.5 text-clay-dark">
                    {formatLabel(resultFormat)}
                    <button
                      type="button"
                      aria-label="Clear format filter"
                      onClick={() => {
                        setDraftFormat("all");
                        setFormat("all");
                        runDeepDive(keyword, "all");
                      }}
                      className="leading-none opacity-60 hover:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                )}
                {FILTER_FIELDS.filter((f) => rangeActive(filters[f.key])).map((f) => (
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
                {status === "enriching" && (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <Spinner /> fetching BSR {progress.done}/{progress.total}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={sendToReverse}
                  disabled={selected.size === 0}
                  className="flex items-center gap-1.5 rounded-lg border border-black/15 bg-white px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-black/5 disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  Reverse ASIN Search{selected.size > 0 ? ` (${selected.size})` : ""}
                </button>
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
                    {hasFilters && (
                      <span className="ml-0.5 rounded-full bg-clay px-1.5 text-[10px] font-semibold leading-4 text-white">
                        {FILTER_FIELDS.filter((f) => rangeActive(filters[f.key])).length}
                      </span>
                    )}
                  </button>
                  {filtersOpen && (
                    <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-black/10 bg-white p-4 text-ink shadow-[0_12px_40px_-12px_rgba(44,39,35,0.25)]">
                      <div className="font-mono text-[11px] uppercase tracking-widest text-muted/70">Format</div>
                      <select
                        className="mt-2 w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-clay"
                        value={draftFormat}
                        onChange={(e) => setDraftFormat(e.target.value as BookFormatFilter)}
                      >
                        <option value="all">All formats</option>
                        <option value="paperback">Paperback</option>
                        <option value="ebook">eBook</option>
                        <option value="audiobook">Audiobook</option>
                      </select>
                      <div className="mt-4 space-y-3">
                        {FILTER_FIELDS.map((f) => (
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
                      <p className="mt-3 text-[10px] leading-snug text-muted/80">
                        BSR fills in after enrichment; filtering on it hides rows still loading.
                      </p>
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
            <div className="overflow-x-auto rounded-b-2xl">
            <table className="w-full min-w-[820px] text-[15px]">
              <thead className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
                <tr>
                  <th className="px-3 py-2.5 font-medium" />
                  <th className="px-3 py-2.5 font-medium" />
                  {DIVE_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className={`cursor-pointer select-none px-3 py-2.5 font-medium transition-colors hover:text-ink ${
                        col.num ? "text-right" : ""
                      } ${sort.key === col.key ? "text-clay-dark" : ""}`}
                    >
                      {col.label}
                      <span className="ml-1">{sort.key === col.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.asin || r.order} className="border-t border-black/5 align-top hover:bg-warm/40">
                    <td className="px-3 py-3 align-middle">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-clay disabled:cursor-not-allowed disabled:opacity-40"
                        checked={selected.has(r.asin)}
                        disabled={
                          !r.asin || (!selected.has(r.asin) && selected.size >= REVERSE_ASIN_MAX)
                        }
                        onChange={() => r.asin && toggleSelected(r.asin)}
                        title={
                          !selected.has(r.asin) && selected.size >= REVERSE_ASIN_MAX
                            ? `Reverse ASIN accepts at most ${REVERSE_ASIN_MAX} books`
                            : "Select to send to Reverse ASIN"
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      {r.imageUrl ? (
                        <img src={r.imageUrl} alt="" loading="lazy" className="h-14 w-auto rounded shadow-sm" />
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="line-clamp-2 max-w-[260px] text-ink">{r.title}</span>
                      <div className="mt-0.5 text-xs text-muted">
                        {r.pending ? <Spinner /> : r.author || "-"}
                      </div>
                      {(r.isBestSeller || r.isAmazonChoice) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {r.isBestSeller && (
                            <span className="rounded-full border border-clay/25 bg-clay-tint px-2 py-0.5 font-mono text-[10px] text-clay-dark">
                              Best Seller
                            </span>
                          )}
                          {r.isAmazonChoice && (
                            <span className="rounded-full border border-black/5 bg-warm px-2 py-0.5 font-mono text-[10px] text-muted">
                              Choice
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted">{r.asin || "-"}</td>
                    <td className="px-3 py-3 text-right font-mono text-muted">
                      {r.priceFrom == null ? "-" : `$${r.priceFrom.toFixed(2)}`}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-muted">
                      {r.ratingValue == null ? "-" : `★ ${r.ratingValue.toFixed(1)}`}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-muted">
                      {r.ratingVotes?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      {r.pending ? (
                        <Spinner />
                      ) : r.bsrShown != null ? (
                        <span className="text-ink">#{r.bsrShown.toLocaleString()}</span>
                      ) : resultFormat === "all" && isAudiobook(r.format) ? (
                        <span className="text-clay-dark" title="Audible rank, not comparable to a Books BSR">
                          Audiobook
                        </span>
                      ) : resultFormat === "all" && isEbook(r.format) ? (
                        <span className="text-clay-dark" title="Kindle Store rank, not comparable to a Books BSR">
                          eBook
                        </span>
                      ) : resultFormat === "all" && r.bsrStore ? (
                        <span className="text-clay-dark" title="not a Books rank, not comparable">
                          {r.bsrStore.replace(/^(Free )?in /i, "")}
                        </span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink">{r.pending ? <Spinner /> : r.publisher || "-"}</td>
                    <td className="px-3 py-3 text-right font-mono text-muted">
                      {r.pending ? <Spinner /> : (r.pages ?? "-")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {status === "done" && rows.length === 0 && (
        <p className="mt-6 text-sm text-muted">No results for this keyword / format.</p>
      )}
    </section>
  );
}
