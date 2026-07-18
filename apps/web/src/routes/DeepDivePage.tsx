import type { BookFormatFilter, SerpBook } from "@kfa/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";

/**
 * Step 2 of the loop: who ranks P1 for a keyword, each competitor enriched with
 * BSR / author / publisher / pages (RapidAPI, 2026-07-18). Two phases: the table
 * renders fast (phase 1), then BSR columns fill progressively (phase 2). The
 * signature insight - SERP purity - is computed client-side from the BSR store.
 */

type Row = SerpBook & { pending: boolean };

// --- Sortable columns (default: BSR ascending — best sellers first) ---
// Author now lives under the title, so it's not its own column.
type DiveSortKey =
  | "title" | "asin" | "priceFrom" | "ratingValue" | "ratingVotes" | "bsrInBooks" | "publisher" | "pages";
type SortDir = 1 | -1;

const DIVE_COLUMNS: { key: DiveSortKey; label: string; num?: boolean }[] = [
  { key: "title", label: "Title" },
  { key: "asin", label: "ASIN" },
  { key: "priceFrom", label: "Price", num: true },
  { key: "ratingValue", label: "Rating", num: true },
  { key: "ratingVotes", label: "Reviews", num: true },
  { key: "bsrInBooks", label: "BSR (Books)", num: true },
  { key: "publisher", label: "Publisher" },
  { key: "pages", label: "Pages", num: true },
];

// Direction a column jumps to on first click. BSR/price ascending (lower = better/cheaper);
// rating/reviews/pages descending (more first); text A→Z.
const DIVE_DEFAULT_DIR: Record<DiveSortKey, SortDir> = {
  title: 1, asin: 1, publisher: 1,
  priceFrom: 1, ratingValue: -1, ratingVotes: -1, bsrInBooks: 1, pages: -1,
};
const DIVE_DEFAULT_SORT = { key: "bsrInBooks" as DiveSortKey, dir: 1 as SortDir };

function compareDive(a: Row, b: Row, key: DiveSortKey, dir: SortDir): number {
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

const isBookStore = (s: string | null) => /books|kindle/i.test(s || "");
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

function Metric({ label, value, sub, flag }: { label: string; value: string; sub?: string; flag?: boolean }) {
  return (
    <div className={`min-w-[128px] rounded-xl border bg-white px-4 py-3 ${flag ? "border-clay/30" : "border-black/5"}`}>
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted/70">{label}</div>
      <div className={`mt-1 font-display text-xl font-bold tabular-nums ${flag ? "text-clay-dark" : "text-ink"}`}>
        {value} {sub && <span className="font-sans text-xs font-normal text-muted">{sub}</span>}
      </div>
    </div>
  );
}

export function DeepDivePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState(params.get("keyword") ?? "");
  const [format, setFormat] = useState<BookFormatFilter>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "enriching" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sort, setSort] = useState(DIVE_DEFAULT_SORT);
  const lastRun = useRef<string | null>(null);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => compareDive(a, b, sort.key, sort.dir)),
    [rows, sort],
  );
  const toggleSort = (key: DiveSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as SortDir } : { key, dir: DIVE_DEFAULT_DIR[key] }));

  async function runDeepDive(kw: string, fmt: BookFormatFilter) {
    const v = kw.trim().toLowerCase();
    if (!v) return;
    lastRun.current = v;
    setStatus("searching");
    setError("");
    setRows([]);
    setTotalResults(null);
    setProgress({ done: 0, total: 0 });
    setSort(DIVE_DEFAULT_SORT);
    try {
      // Phase 1 - search.
      const res = await api.deepDive(v, fmt, 20);
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
      runDeepDive(incoming, format);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setParams({ keyword: keyword.trim().toLowerCase() }, { replace: true });
    runDeepDive(keyword, format);
  };

  const sendToReverse = () => {
    const asins = [...new Set(rows.filter((r) => r.asin).map((r) => r.asin))].slice(0, 20);
    navigate(`/reverse-asin?asins=${encodeURIComponent(asins.join(","))}`);
  };

  // --- derived metrics (tighten as BSR fills) ---
  const withStore = rows.filter((r) => r.bsrStore);
  const books = withStore.filter((r) => isBookStore(r.bsrStore));
  const purity = withStore.length ? books.length / withStore.length : null;
  const lowContent = withStore.length - books.length;
  const prices = rows.map((r) => r.priceFrom).filter((v): v is number => v != null);
  const votes = rows.map((r) => r.ratingVotes).filter((v): v is number => v != null);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const avgVotes = votes.length ? Math.round(votes.reduce((a, b) => a + b, 0) / votes.length) : null;
  const indie = rows.filter((r) => (r.publisher || "").toLowerCase().startsWith("independently")).length;

  const busy = status === "searching" || status === "enriching";

  return (
    <section>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Competitors</h1>
      <p className="mt-2 max-w-2xl text-lg leading-relaxed text-muted">
        The books ranking on Amazon for a keyword.
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-3" onSubmit={submit}>
        <input
          className="min-w-[220px] flex-1 rounded-lg border border-black/10 bg-white px-4 py-3 font-mono text-[15px] text-ink outline-none placeholder:text-muted/50 focus:border-clay"
          placeholder="gratitude journal"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <select
          className="rounded-lg border border-black/10 bg-white px-4 py-3 text-[15px] text-ink outline-none focus:border-clay"
          value={format}
          onChange={(e) => setFormat(e.target.value as BookFormatFilter)}
        >
          <option value="all">All formats</option>
          <option value="paperback">Paperback</option>
          <option value="ebook">eBook</option>
        </select>
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
          <div className="mt-8 flex flex-wrap gap-3">
            <Metric label="Indexed results" value={totalResults?.toLocaleString() ?? "-"} sub="on Amazon" />
            <Metric
              label="SERP purity"
              value={purity == null ? "-" : `${Math.round(purity * 100)}%`}
              sub={`${books.length}/${withStore.length} in Books/Kindle`}
              flag={purity != null && purity < 0.6}
            />
            <Metric label="Low-content?" value={String(lowContent)} sub="non-book rank" flag={lowContent > 0} />
            <Metric label="Avg price" value={avgPrice == null ? "-" : `$${avgPrice.toFixed(2)}`} sub="shown" />
            <Metric label="Avg reviews" value={avgVotes == null ? "-" : avgVotes.toLocaleString()} sub="shown" />
            <Metric label="Indie" value={String(indie)} sub="independently pub." />
          </div>

          <div className="mt-5 flex items-center gap-4">
            <button
              onClick={sendToReverse}
              className="rounded-lg bg-clay px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-clay-dark"
            >
              Send ASINs → Reverse ASIN
            </button>
            {status === "enriching" && (
              <span className="font-mono text-sm text-muted">
                <Spinner /> fetching BSR {progress.done}/{progress.total}
              </span>
            )}
          </div>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
            <table className="w-full min-w-[820px] text-[15px]">
              <thead className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
                <tr>
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
                      ) : r.bsrInBooks != null ? (
                        <span className="text-ink">#{r.bsrInBooks.toLocaleString()}</span>
                      ) : r.bsrStore ? (
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
        </>
      )}

      {status === "done" && rows.length === 0 && (
        <p className="mt-6 text-sm text-muted">No results for this keyword / format.</p>
      )}
    </section>
  );
}
