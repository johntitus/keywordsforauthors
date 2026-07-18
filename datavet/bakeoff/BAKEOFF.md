# Deep-dive source bakeoff — DataForSEO vs RapidAPI

Run 2026-07-18 via the datavet endpoints (`/api/deep-dive` = DataForSEO merchant/products,
depth 50 · `/api/rapid-deep-dive` = real-time-amazon-data search + top-20 BSR enrichment).
Raw per-keyword responses live beside this file (`<slug>.dfs.json`, `<slug>.rapid.json`);
machine-readable rollup in `summary.json`.

Three keywords chosen to stress different niche shapes:
fiction (`cozy mystery books`), low-content-prone (`gratitude journal`), nonfiction (`keto cookbook`).

## Results

| Keyword | DFS cost | DFS total competitors | DFS organic/sponsored | RapidAPI BSR "in Books" | RapidAPI bsrStore mix |
|---|---|---|---|---|---|
| cozy mystery books | $0.0033 | 592 | 50 / 2 | **8 / 20** | in Books 7 · Free Kindle 4 · Kindle 4 |
| gratitude journal | $0.0033 | 64,589 | 50 / 4 | **7 / 20** | **in Office Products 13** · in Books 7 |
| keto cookbook | $0.0033 | 41,566 | 50 / 4 | **18 / 20** | in Books 18 · Kitchen 1 · Kindle 1 |

## Findings

### 1. Is RapidAPI organic-only? — Probably yes, but it never *labels* placement.
Testing titles that are **sponsored-only in DataForSEO** (not also ranking organically): **0 of them
appeared in RapidAPI** across all three keywords (sponsored-only counts were 2 / 2 / 1 — small).
So no positive evidence RapidAPI surfaces pure ad placements; consistent with "organic-only." BUT:
- Sample is tiny, and RapidAPI page 1 (48) is shorter than DFS depth 50 — an absent item could be
  truncation, not exclusion. Treat as **"likely organic, unconfirmed."**
- Regardless, RapidAPI gives **no organic/sponsored flag, no rank_absolute, and no reliable total
  competitor count**. DataForSEO cleanly separates `amazon_serp` vs `amazon_paid` (brief §2) and
  reports `se_results_count`. For the *structure* of the competitor set, DFS wins outright.

### 2. BSR comparability is a niche-dependent minefield — and `bsrStore` is itself a signal.
"#N in Books" is only comparable when the ranked edition is a print book in the Books catalog:
- **keto cookbook: 18/20** — nonfiction is paperback-dominated, BSR works great.
- **cozy mystery: 8/20** — fiction is Kindle-heavy; the rest rank in *Kindle Store* (incl. free), a
  different chart, not comparable.
- **gratitude journal: 7/20**, and **13/20 rank in "Office Products"** — blank journals/planners are
  catalogued as Office Products, not Books.

That last one is the sleeper win: **`bsrStore` doubles as a low-content / format classifier.**
"in Office Products" ≈ blank journal; "in Kindle Store" ≈ ebook; "in Books" ≈ real print book. It
corroborates SERP purity for free. Keep it in the schema, not just the numeric rank.

### 3. RapidAPI format data is unreliable for low-content.
`gratitude journal`: **32/48 RapidAPI rows had `book_format: null`**, vs DFS labelling Paperback 22 /
Hardcover 19. So a paperback/ebook toggle driven off RapidAPI's format field will silently drop
journals. Format filtering should lean on DFS labels (or be treated as best-effort).

### 4. Economics — the two billing models are not comparable per-call, so don't force them to be.
- **DataForSEO**: flat **$0.0033 / deep dive**, cost logged per call, effectively unlimited (pay-per-use).
- **RapidAPI Pro**: **10,000 calls / month**, flat subscription. A dive that enriches top 20 cost
  **5 calls** here (1 search + 4 detail — the extra detail calls are retries on silently-dropped
  ASINs). At 5 calls/dive that's only **~2,000 dives/month** before the cap.

## Recommendation — Hybrid, DataForSEO-backboned

**DataForSEO `merchant/amazon/products` is the deep dive.** It owns the competitor SERP: rank,
organic-vs-sponsored, SERP purity, true competitor count, and the ASIN feed into Reverse ASIN. It's
cheap, cost-logged, and the only source that separates ads from organic.

**RapidAPI `Product_Details` is a BSR/publisher/pages enrichment layer** on the **top N organic
print-format ASINs that DataForSEO already vetted** — *not* RapidAPI's own search. Two benefits:

1. **It sidesteps the unresolved "is RapidAPI organic?" question entirely** — we never use RapidAPI's
   ranking, only its per-ASIN detail lookup. The architecture is robust to the thing the bakeoff
   couldn't fully confirm.
2. **It slashes RapidAPI call usage.** No search call; only detail batches. Enrich **top ~10 print
   (Paperback/Hardcover/Mass Market) organic ASINs** → ~1–2 calls/dive → **~5,000–8,000 dives/month**
   within the 10k cap. Skipping Kindle/Audiobook ASINs also avoids wasting calls on rows whose BSR
   won't be "in Books" anyway.

**Store the `bsrStore` string, not just the numeric rank** — surface "in Books" as the comparable
number and flag "Office Products"/"Kindle Store" as a low-content/format tell.

**Degrade gracefully at the cap:** if RapidAPI is unavailable or the monthly budget is spent, the deep
dive still renders fully from DataForSEO — BSR columns just show "—". BSR is an enhancement layer, never
a hard dependency.

### Concretely, per deep dive
1. DFS merchant/products (Books, depth ~40–50) → organic list + rank + purity + count. `$0.0033`.
2. Take top ~10 organic ASINs whose format ∈ {Paperback, Hardcover, Mass Market}.
3. RapidAPI Product_Details (1 batch, reconcile + retry) → BSR (in Books) + publisher + pages. ~1–2 RapidAPI calls.
4. Render DFS table + BSR/publisher/pages columns; `bsrStore` flags non-Books ranks.

### Open follow-ups
- Confirm the organic-only question on a deliberately ad-heavy keyword (more sponsored-only items).
- Decide the paperback-normalization policy: enrich the ranked ASIN as-is (sparse BSR on Kindle-heavy
  fiction) vs. resolve to the paperback edition first (comparable BSR, +1 call/book). Fine to ship
  as-is for v1 with `bsrStore` transparency.
