# Keywords for Authors — CLAUDE.md

Credit-based web app for **Amazon KDP authors**: find what book buyers search for,
see who ranks, and reverse-engineer competitors' books into the keywords they own.

**Full context lives in two docs — read them before non-trivial work:**
- [ProjectBrief.md](ProjectBrief.md) — the product, data source, cost/credit model, caching, positioning, open questions. This is the source of truth for *what* and *why*.
- [TechStack.md](TechStack.md) — the settled stack and integration seams. Source of truth for *how it's built*.
- [TODO.md](TODO.md) — deferred ideas/backlog (relevance sort, junk-keyword filtering).
- [designmockup/Keywords for Authors.html](designmockup/) — a bundled Claude-design mockup of the **marketing landing page** (two visual directions: "1a Slate workbench" / "1b Friendlier warm", same layout & copy). It is the public homepage, *not* the in-app tool UI. It's a self-contained gzip+base64 bundle; open it in a browser to view.

## ⚠️ Deep dive changed sources — read before touching it (decided 2026-07-18)

After live experimentation (see `datavet/` + `datavet/bakeoff/BAKEOFF.md`), the **DEEP DIVE
switched from DataForSEO Merchant to RapidAPI `real-time-amazon-data`** — because RapidAPI
returns **BSR** (+ author, publisher, page count), which DataForSEO can't. **DataForSEO still
powers SEARCH and REVERSE ASIN** (unchanged). ProjectBrief §2/§3.3/§4/§6 carry the formal
callouts; memory `bsr-via-rapidapi-hybrid` has the load-bearing details. Settled shape:

- Search (1 quota call) → cap **top 20** competitors (title, ASIN, cover, price, rating).
- BSR enrichment: `product-details` per ASIN. **Billed per ASIN *returned*** (batching doesn't
  save; drops are free); search = 1. **Enrich ALL 20** so no half-empty column.
- **RapidAPI rate-limits bursts (~10 concurrent → 429).** Enrich in **batches of 3, fired
  all-concurrently** (7 requests for 20 books ≈ 4.5s first paint / 10s total). 429s retry with
  backoff. Per-ASIN BSR **cache** (KV in prod) is the margin lever — warm repeats ≈ 1 call.
- SERP purity computed from `bsrStore` ("in Books"/"Kindle" = real book; "in Office Products"
  = journal). Deep dive is priced at **~5 credits** (exception to the flat-1-credit rule; §4).

**`datavet/` is the experimental reference tool** — a standalone Node server (`node datavet/server.mjs`,
:5050) + single `index.html`, decoupled from Cloudflare. It implements the full RapidAPI deep-dive
flow (progressive render, cache, quota meter) and the DataForSEO search/reverse-asin vetting. **Keep
it for reference; it is not the product.** Needs `RAPIDAPI_KEY` + DataForSEO creds in `apps/api/.dev.vars`.

**▶ NEXT STEP: build the real tool** in `apps/` (Worker + React SPA) — port the datavet deep-dive
logic into the real architecture (KV cache, credits, Clerk auth). Not started yet.

## Current state

npm-workspaces monorepo scaffolded (2026-07-17) — typechecks and builds clean. Structure:

```
packages/shared   @kfa/shared — Zod schemas + constants (the DataForSEO decisions live here)
apps/api          @kfa/api    — Hono Worker: /api/search, /deep-dive, /reverse-asin + CreditLedger DO, Drizzle/D1 schema
apps/web          @kfa/web    — Vite React SPA (Tailwind v4, React Router 7, TanStack Query) — in-app workbench
landing/          Standalone static marketing landing page (index.html, Tailwind via CDN) — the recreated
                  "Slate/warm workbench" mockup. Not part of the npm workspace; serve with any static server.
                  Fonts (Poppins/JetBrains Mono via Google Fonts) are stand-ins for the design-tool fonts.
```

**Scaffold status: wired but stubbed.** The DataForSEO HTTP calls, Clerk/Stripe auth + webhooks, D1 snapshot writes, and the cron refresh are marked `TODO` — the flow (validate → cache → spend credit → fetch → cache) is implemented end-to-end for `/api/search` as the reference pattern.

### Dev commands

```
npm install
npm run typecheck            # all workspaces
npm run dev:api              # wrangler dev on :8787 (needs apps/api/.dev.vars filled in)
npm run dev:web              # vite on :5173, proxies /api -> :8787
npm run db:generate         # drizzle migrations from apps/api/src/db/schema.ts
```

Secrets: `apps/api/.dev.vars` (Worker, gitignored) and `apps/web/.env` (public VITE_ keys, gitignored). Copy from the `.example` files. Cloudflare resource IDs in `apps/api/wrangler.toml` need creating (`wrangler d1 create kfa-db`, `wrangler kv namespace create CACHE`).

## The product in one picture

Three tools that form a **loop** — each tool's output is the next tool's input:

```
SEARCH a seed keyword  →  related keywords + Amazon search volumes
        ↓
DEEP DIVE a promising one  →  who ranks P1, their ASINs, SERP purity
        ↓
REVERSE ASIN those books  →  the keywords those books rank for
        └──────────→ back to SEARCH with sharper seeds
```

The product **is** this cycle, not three separate utilities. Anything that breaks a
handoff (e.g. a deep dive that doesn't surface ASINs) breaks the product.

**Scope is deliberately narrow: Amazon US, Books department.** The narrow scope is the
precondition for the caching margin (§5/§7), not a limitation to design around.

## Tech stack (see TechStack.md for the full table + rationale)

TypeScript everywhere · React (Vite SPA) + React Router + TanStack Query · Tailwind +
shadcn/ui · **Cloudflare Workers + Hono** API · **D1** (SQLite) + Drizzle ORM (relational +
snapshot table) · **Workers KV** (DataForSEO response cache) · **Durable Objects**
(race-free credit deduction + idempotency) · **Cron Triggers** (monthly head-term
refresh) · **Clerk** auth · **Stripe Checkout** (credit packs) · **Zod** validation ·
**Resend** email · **Wrangler** + **npm workspaces** (frontend/Worker share types & Zod schemas).

## Data source: DataForSEO — the three calls

All against `location_code: 2840` (US), `language_code: en`. **Read the `cost` field on every
response and log it; don't estimate.** Two billing models are in play (Labs = per task + per
item; Merchant = per task only) — see brief §2.

| Tool | Endpoint | Decided settings |
| --- | --- | --- |
| **SEARCH** | `dataforseo_labs/amazon/related_keywords/live` | `depth: 3`, `limit: 258`, `ignore_synonyms: true`. No `filters`/`order_by`/`department` supported — work around by seeding book-native language and filtering client-side. |
| **REVERSE ASIN** | `dataforseo_labs/amazon/ranked_keywords/live` | One ASIN per task (batch as multiple task objects). **Mandatory server-side filter** (below). |
| **DEEP DIVE** | `merchant/amazon/products/live/advanced` | `department: "Books"`, `sort_by: "relevance"`. Flat $0.005; cheapest + most decision-relevant. |

### Non-negotiable gotchas (these are load-bearing — violating them ships wrong data)

1. **Reverse-ASIN is dangerous unfiltered.** Raw, a WiFi extender "ranks" for "baby girl"
   (brief §3.2). Always send:
   ```json
   "filters": [["ranked_serp_element.serp_item.rank_absolute","<",20],"and",
               ["keyword_data.keyword_info.search_volume",">",50]],
   "order_by": ["keyword_data.keyword_info.search_volume,desc"]
   ```
   The `rank_absolute < 20` threshold is the single highest-leverage number in the product
   and is **an unsettled guess** (open question §10.1) — see caching warning below.
2. **Deep dive: filter by element `type == "amazon_serp"` before computing anything.** The
   response mixes organic / paid / editorial / related. Averaging ads into a competition metric is wrong.
3. **Extract, don't store, the payloads.** Reverse-ASIN repeats a full product record per
   keyword — keep only `keyword`, `search_volume`, `rank_absolute`; discard ~95%.
4. **Snapshot every real fetch** to a timestamped `(keyword, search_volume, fetched_at)` table
   from day one. DataForSEO has **no Amazon trend history at any price** — the trend column is
   an asset that accrues, not a feature you can buy. Never blend Amazon and Google volumes.
5. **Write snapshots only on real fetches, never on cache hits** (a cache-hit snapshot
   manufactures fake flat trend lines). TTL sets trend granularity; start at **30 days**.
6. **No BSR / sales / revenue** (brief §6). The product shows demand + competition, not
   earnings, and says so plainly in the UI. Don't add per-ASIN BSR calls.

### SERP purity — the signature insight

Book-format organic results ÷ total organic results, computed client-side from the deep-dive
SERP. "Is this a book niche or blank journals wearing a keyword?" No competitor labels it. Free.

## Credit & cache model

- **Every action = 1 credit.** Search 1, deep dive 1, reverse ASIN **1 per ASIN**. Do not
  price actions by underlying cost (they vary 6×) — eat the variance. Design number: **$0.021/credit**.
- Packs: 100/$12 · 500/$45 · 2,000/$120. 50 free credits on signup (via Clerk user-created webhook → D1 row + grant).
- **Cache is where the margin is.** Stable keys: search=(seed,location,depth,ignore_synonyms);
  reverse=(asin,location,**filters**); deep dive=(keyword,department,location). Still charge a
  credit on a cache hit. **⚠️ Settle the §10.1 `rank_absolute` filter design *before* the
  reverse-ASIN cache accrues** — `filters` is in the key, so tuning it invalidates every cached row.

## Positioning / tone

Audience: skeptical solo self-publishers, burned by course-sellers. **Tone: a workbench, not a
rocket ship** — plain, competent, understated. Anything resembling get-rich-quick is a red
flag. Copy must survive being retyped from memory in a Reddit/Facebook thread.

## Conventions

- Reference files as clickable links, e.g. [ProjectBrief.md](ProjectBrief.md).
- The brief's **open questions (§10)** are genuinely open — flag rather than silently resolve,
  especially §10.1 (filter design) which gates the cache.
- Cost transparency: log cost-per-call by action type from day one (§10.2) to learn the real blended rate.
