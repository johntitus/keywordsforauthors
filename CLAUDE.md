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

- Search (1 quota call for paperback/all) → cap **top 20** competitors (title, ASIN, cover, price,
  rating). **ebook/audiobook now search the Kindle/Audible department + paginate (~2 calls)** — see
  the 2026-07-19 session log above.
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

**Real tool status (updated 2026-07-19):** the three tools are built in `apps/` (Worker + SPA) with
live DataForSEO + RapidAPI calls and KV caching. **Auth is ON: tools require sign-in, and signup
grants 50 free credits — but credit DEDUCTION is still OFF** (2026-07-19d — see that session log).
The tool endpoints are gated (`requireUser`/`userId` check + SPA `ProtectedRoute`); the Clerk
`user.created` webhook + a lazy first-read both provision users & grant the free credits idempotently;
`/api/credits` + a nav balance pill are live. Nothing is spent yet — the `CreditLedger.spend` path is
built but not called. **SEARCH now runs the full path**: on every
seed it merges `related_keywords` with competitor mining (product-search the seed → reverse-ASIN the
top ~15 books), tiers results **High/Medium/Low**, applies a min-volume floor + a never-show
blocklist, and shows the seed's competitor (indexed-results) count. See memory
`zero-volume-trust-problem` for the load-bearing details and `TODO.md` for deferred follow-ups
(per-keyword indexed counts, search Filters/Options panel, junk-keyword filtering).

## Session log — 2026-07-20 (credit deduction ON + homepage logo)

**Deduction (flat 1 credit each, decided this session; Stripe still deferred).** Verified live with a
minted session JWT: search 50→49 and idempotent repeat 49→49; reverse-ASIN 3 ASINs 49→46 and repeat
`creditsSpent=0`; D1 `users.credits`=46 and `credit_transactions` = signup+50 / search−1 / reverse×−1.

- **`CreditLedger`:** replaced the single `spend` with **`spendBatch(keys, amountEach)`** +
  **`refundBatch`**. Each key = one chargeable unit; charges only NOT-yet-charged keys, **all-or-
  nothing** vs balance; returns `chargedKeys`. Idempotency marker `spent:<key>` persists (repeats free).
- **`credits.ts`:** `chargeCredits(env, uid, keys, reason)` — **calls `grantSignupCredits` first**
  (so a brand-new user who acts before the pill provisions them isn't falsely 402'd), then `spendBatch`;
  best-effort mirrors the debit into D1 `users` + one `credit_transactions` row per key. `refundCharge`
  staged (unused — see below). `CREDIT_COSTS` in shared constants.
- **Charging model — charge UP FRONT, NO refund-on-failure.** Idempotency makes this safe: a failed
  fetch leaves the KV cache empty, so a retry is `alreadyCharged` → **free** and completes. Only a
  *permanently* failing keyword would cost 1 credit (≈never). So `refundBatch`/`refundCharge` are kept
  as **staged utilities** (for Stripe refunds / an explicit failure-refund toggle), not wired.
- **Idempotency keys (per user, charge once ever):** search `search:<uid>:<kw>`; deep dive
  `deep_dive:<uid>:<kw>` (**keyword-only — switching formats does NOT re-charge**; phase-2
  `/api/deep-dive/bsr` is part of the same action and is **not charged**); reverse `reverse_asin:<uid>:<asin>`
  (per ASIN — a batch charges only new ASINs; `creditsSpent` = `chargedKeys.length`). Charged on cache
  hits too (brief §5). **The suggest endpoint is gated but NOT charged** (typeahead).
- **402:** `chargeCredits` false ⇒ `{error, code:INSUFFICIENT_CREDITS}` 402. SPA `lib/api.ts` now throws
  an **`ApiError`** carrying `status`+`code`; the existing per-tool error text shows the message.
- **Pill refresh:** each tool invalidates `["credits"]` on success (Search mutation `onSuccess`; Deep
  dive after the charged phase-1 call; Reverse in the result `useEffect`).

**Branding + route rename:** the old `BrandMark` target-glyph is replaced everywhere (homepage
header + footer, workbench `AppLayout` header) by the user's magnifier logo (`apps/web/src/logo2.svg`,
chosen over `logo.svg`) via `<img>`; `BrandMark.tsx` deleted. ⚠️ The delivered SVGs relied on external
CSS classes (`.big`/`.g`/`.h`) for their strokes — made **self-contained** (inline stroke `#c2673f`,
`xmlns`) so they render standalone; `.svg` imports typed via `vite/client`. **Favicon:**
`apps/web/public/favicon.svg` + `<link rel="icon" type="image/svg+xml">` in `index.html` (Vite copies
`public/` to the build root). **Route rename:** the Competitors tool moved from `/deep-dive` →
**`/competitors`** (main.tsx route, AppLayout tab, Search row button, homepage links). ⚠️ The **API
endpoint stays `/api/deep-dive`** — only the SPA route changed. No redirect from the old path (dev-only).

## Session log — 2026-07-19d (gate the tools + grant free credits on signup)

Built on 19c. Scope (user decision): wire the `user.created` webhook + gate the tools; **SKIP credit
deduction and Stripe.** So credits are now GRANTED but never SPENT. Typecheck + build clean; verified
live end-to-end with a real minted session JWT (signed-out → 401; valid token → `{"credits":50}`,
idempotent; D1 `users` + `credit_transactions` rows written).

**Provisioning (`apps/api/src/credits.ts` + `CreditLedger.grantOnce`):**
- Signup grant is idempotent via a new DO `grantOnce(amount, key)` (keyed `signup` per user, since the
  DO is per-user). Driven from TWO places without double-granting: the Clerk webhook (proper path) AND
  a lazy first-read in `GET /api/credits` (self-heals local dev where no webhook tunnel is set up, and
  the eventual-consistency gap before the webhook lands). `getBalance` = `grantSignupCredits(env,uid)`.
- D1 `users`/`credit_transactions` are the projection (best-effort; DO is authoritative). The lazy path
  leaves `email=""` (no session email); the webhook backfills it via `onConflictDoUpdate`. Deduction
  intentionally absent — `CreditLedger.spend` exists but is uncalled.

**Webhook (`/api/webhooks/clerk`):** real handler now. `verifyWebhook(c.req.raw, { signingSecret })`
from `@clerk/backend/webhooks`; `user.created`/`updated` → grant + email sync, `user.deleted` →
`removeUser` (DO `reset()` + D1 cleanup). Returns **501 until `CLERK_WEBHOOK_SECRET` is set** (fails
loud, not silent). Excluded from the auth middleware (Svix signature, not a session). To test locally:
`clerk webhooks listen ...` tunnel + add the relay URL in the Dashboard + set the secret in `.dev.vars`.

**Gating:** `PROTECTED_PATHS` (search, deep-dive, deep-dive/bsr, reverse-asin, keywords/suggest,
credits) 401 when `!c.var.userId`. ⚠️ **Gate off `c.var.userId` (already resolved by `attachUser`),
NOT a second `getAuth()` call** — `@hono/clerk-auth`'s `getAuth` is `c.get("clerkAuth")(opts)`, and if
`clerkMiddleware` was skipped it's `undefined(...)` → 500. SPA mirror: `ProtectedRoute` shows a
sign-in card inside the AppLayout chrome; nav has a live **credit balance pill** (`CreditBalance`,
queries `/api/credits` only when signed in).

**Landing (`HomePage.tsx`) auth CTAs:** "Sign in" (moved next to "Start free") and all three "Start
free" buttons now fire the **Clerk modal in place** (`SignInButton`/`SignUpButton mode="modal"` +
`forceRedirectUrl="/search"`) instead of routing to the gated workbench (which showed a redundant
second sign-in). Signed-in visitors see "Open workbench" + `UserButton` instead. Shared `StartFreeCta`
helper drives the three placements. Global CSS: enabled `<button>`s get `cursor: pointer` (index.css).

**⚠️ wrangler dev does NOT re-read `.dev.vars` on source-edit reloads — only on a full restart.** A
newly-added secret (here `CLERK_SECRET_KEY`) won't take effect until you kill & restart `dev:api`.
Symptom that burned time: `clerkMiddleware` self-disabled (empty secret) so every gated route 500'd on
`getAuth`. If auth behaves as though a secret is missing after you just set it, restart the Worker.

## Session log — 2026-07-19c (Clerk auth foundation — non-blocking)

Set up Clerk with the Clerk CLI (linked app `app_3Gjr9wsViGI96DIVaCmzs4WdGd6`, dev instance).
Typecheck + web build clean; verified live against local Worker (:8787) + SPA. **Auth is wired but
deliberately NON-BLOCKING** — tools still work logged-out, no credit spend. Decision (2026-07-19):
ship the foundation only; gating + the user.created webhook are staged, not turned on.

**Frontend (`@clerk/react` v6):**
- `main.tsx`: `ClerkProvider` with `publishableKey` (init added the provider but omitted the key —
  had to fix) + a `ClerkTokenBridge` that registers Clerk's hook-only `getToken` into a module-level
  accessor (`apps/web/src/lib/auth.ts`) so the plain-fetch `lib/api.ts` (not a component) can attach
  `Authorization: Bearer <jwt>` on every request. Null token ⇒ request still goes out (auth off).
- Nav auth controls in `AppLayout.tsx`: **v6 uses `<Show when="signed-in|signed-out">`**, NOT
  `SignedIn`/`SignedOut` (those aren't exported by `@clerk/react`). `SignInButton`/`SignUpButton`
  (modal) + `UserButton`. `UserButton` takes NO `afterSignOutUrl` in v6 — set it on `ClerkProvider`.

**Backend (Worker, `@hono/clerk-auth` + `@clerk/backend`):**
- `apps/api/src/auth.ts`: `attachUser` (reads `getAuth(c).userId` → `c.var.userId`, null when signed
  out; non-blocking) and a staged `requireUser` (401s signed-out — not mounted yet).
- `index.ts`: `clerkMiddleware()` + `attachUser` applied globally after CORS, **skipping**
  `/api/webhooks/*` (those verify via Svix, not a session) and **self-disabling when
  `CLERK_SECRET_KEY` is unset** so nothing breaks pre-config. `Variables.userId` is now `string | null`.

**Env (monorepo split — load-bearing):** the Worker needs BOTH `CLERK_SECRET_KEY` and
`CLERK_PUBLISHABLE_KEY` in `apps/api/.dev.vars` (`@hono/clerk-auth` reads both). The SPA needs only
`VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env`. `clerk init` wrongly put the SECRET in the frontend
`.env` — relocated it to the Worker and stripped it from the frontend. ⚠️ `clerk doctor` warns
"`.env` is missing CLERK_SECRET_KEY" — that's EXPECTED here (it inspects the SPA env; the secret
correctly lives Worker-side). ⚠️ This sandbox BLOCKS bash commands that capture a secret value from
`.env`/`.dev.vars` (command substitution / file-to-file copy of the secret) — use the length-only
`awk -F= '{print $1, length($2)}'` form to inspect, and let the user place secrets when bash refuses.

## Session log — 2026-07-19b (unified table headers, per-table Filters + CSV export)

Front-end polish pass across all three tools. Typecheck + build clean.

**Cost note (cold/uncached, estimated from ProjectBrief §2 unit prices):** Search ≈ **$0.27**
(1 credit — underwater), Competitors ≈ **$0.06** (5 credits), Reverse ASIN ≈ **$0.16/10 ASINs**
(1 credit/ASIN). ⚠️ **Search is the expensive tool, not the deep dive** — `mineCompetitors` runs
on EVERY search (not just dry ones, despite the `RECOVERY_*` naming) and its per-ASIN reverse-ASIN
calls are ~90% of search cost. The $0.021/credit design number + blended-cost table **predate
this** and need re-derivation (ProjectBrief §10.2). Mitigation shipped: **`RECOVERY_MAX_BOOKS`
15 → 8** — halves the dominant cold-search cost (~$0.27 → ~$0.16) while keeping the co-occurrence
signal + cache population. Bigger lever left on the table (not taken, deliberately): gate mining
to only fire on thin/dry related-keyword results.

**Shared table-header pattern** (Search / Competitors / Reverse ASIN each got the same header bar
inside the results box): left = count text (+ removable filter chips), right = a white **Filters**
button (funnel icon, clay count badge) with a dropdown + a white **Export to CSV** button.
- ⚠️ **Overflow gotcha:** the results box no longer uses `overflow-hidden` (it clipped the Filters
  dropdown when the table collapsed to few/0 rows). Corner-rounding moved to an **inner wrapper**
  around the table only (`overflow-hidden rounded-b-2xl`), so the dropdown can escape the box.

**SEARCH:** header reads "N related keywords found" (cached/fresh chip removed). Filters = min/max
**Volume** (client-side; rows with null volume fail a bound). CSV = Keyword, Volume, Relevance.

**COMPETITORS (deep dive):**
- **All metric widgets removed** (SERP purity / low-content / avg price / etc. gone). Header =
  "Top 30 competitors of 430 on Amazon" (filtered: "N of top 30 competitors · 430 on Amazon").
- **Cap raised 20 → 30** (`deepDiveInput.limit` default 30, still max 48; `MAX_PAGES` stays 3).
  ~2 RapidAPI pages of ~16; format-filtered searches may fall short — that's fine. **Every row
  still gets BSR** (cost scales ~1.5×; flat ~5-credit price now covers more enrichment).
- **Format selector moved into the Filters dropdown** (a `<select>`, applied on **Apply** →
  refetch; numeric filters persist). Active format shows a removable header chip.
- Filters = min/max **Price, Rating, Reviews, BSR** (client-side). Row checkboxes (≤10) + **Reverse
  ASIN Search** button now live in the header button group. BSR column header is just **"BSR"**.
- CSV = Title, Author, ASIN, Price, Rating, Reviews, BSR, Publisher, Pages.

**REVERSE ASIN:**
- **Enter runs the search** (folds any in-progress draft in first); comma/space/tab make a chip.
- Placement (all/organic/sponsored) moved into the Filters dropdown as an **Apply-based** `<select>`
  (draft → commit on Apply), plus min/max **Volume, Avg Rank, Competitors**. Removable chips.
- **CSV = Option A** (one row per keyword): Keyword, Volume, Avg Rank, Competitors, Placement.
  (Tried Option B long/tidy per keyword×book — rejected.)

**Backend:**
- `by` (and all blocklisted tokens) now filtered from **/api/reverse-asin** results too (was only
  applied in /api/search). Raw ranked cache keeps them; filtered on read.
- **`document.title` per tool** ("Reverse ASIN - Keywords for Authors", etc.) via `AppLayout`.
- Note: the SEARCH page's `seedIndexedResults` competitor count is fetched but **no longer shown**
  (widget removed). The two "competitors" totals differed (209 vs 212) — same code path
  (`rapidSearch total_products`), just Amazon's approximate count sampled at two cache times.

## Session log — 2026-07-19 (workbench polish + keyword autosuggest)

Shipped on top of the "real tool status" above. All typecheck + build clean; verified against a
live local Worker.

**Search & Competitors UI:**
- SEARCH: dropped the confusing **"Books"** competitor-overlap column; the per-row action button
  is renamed **"Deep dive" → "Competitors"** (still routes to `/deep-dive`).
- COMPETITORS (deep dive): the table now **sorts only after BSR enrichment finishes** — rows fill
  in original relevance order during enrichment so they don't jump around, then sort once.
- **Per-format BSR.** Under a single format the BSR column shows that store's own rank — header
  reads **BSR (Books / Kindle / Audible)** — sourced from a new `bsrRank` (first "#N in <store>").
  Under **all formats** only the cross-comparable **"in Books"** rank (`bsrInBooks`) shows a number;
  ebook/audiobook rows get a clean **eBook / Audiobook** label instead of a raw store/category
  string. Paperback/hardcover rows KEEP their raw `bsrStore` so the "in Office Products = blank
  journal" SERP-purity signal survives.
- New **Audiobook** format option (schema enum + UI). Default stays **All formats**.

**Deep-dive data fixes (RapidAPI):**
- **ebook/audiobook search the Kindle/Audible *department*** (`category_id: digital-text` / `audible`)
  and **paginate up to 3 pages** to fill the 20 cap — previously they only post-filtered the blended
  all-formats page, so an audiobook search returned ~4. Paperback keeps its browse-bin; `all` stays
  blended (`aps`). ⚠️ ebook/audiobook deep dives now cost ~2 search calls (once, then cached).
- **Audiobooks return an empty `product_information`;** publisher + real price are backfilled from
  `product_details` (its BSR is an Audible rank — deliberately NOT surfaced as a Books BSR; audiobook
  price is `$0.00` in phase-1 search, real price only in product-details).
- Cache keys bumped for the shape/logic changes: per-ASIN BSR `bsr:` → **`bsr:v2:`**, deep-dive
  search `deepdive:` → **`deepdive:v2:`**.
- **Reverse-ASIN capped at 10 ASINs** (client + server, `reverseAsinInput.max(10)`).

**Keyword autosuggest — NEW, D1-backed:**
- Both the SEARCH seed input and the COMPETITORS keyword input are typeahead fields
  (`apps/web/src/components/KeywordAutosuggest.tsx`): suggest from keywords we've already observed,
  ranked by search volume, **min prefix 3**, 150 ms debounce, keyboard + mouse select.
- `GET /api/keywords/suggest?q=` → prefix query (`LIKE 'q%' ORDER BY search_volume DESC LIMIT 10`)
  over a new D1 **`keywords`** dictionary table (one deduped row per keyword; **distinct from
  `keyword_snapshots`**, which is the still-TODO §5 trend history — the dictionary is just a lookup
  index, upserted freely including on cache hits).
- **Capture** (fire-and-forget `waitUntil`, best-effort): `/api/search` indexes seed + related +
  reverse-ASIN keywords (on hit AND miss); `/api/deep-dive` indexes the seed only (results are books);
  `/api/reverse-asin` indexes the ranked keywords. A keyword's volume backfills via the upsert's
  `coalesce` when a volume-bearing sighting arrives.
- **D1 is now wired** (Drizzle client `apps/api/src/db/client.ts`; committed migration in
  `apps/api/drizzle/`). Local applied via `db:migrate:local`. Everything degrades gracefully if D1 is
  unprovisioned (suggest returns `[]`, capture no-ops) — so search never breaks.
- ⚠️ **D1 caps bound parameters at 100/query** — the dictionary batch-insert chunks at **25 rows ×
  3 cols = 75**. (First cut used 50 rows → silent `too many SQL variables`, swallowed by the
  best-effort catch. If you touch batch D1 writes, respect the 100-param cap.)

**Prod deploy still needs** (unchanged, plus D1): `wrangler d1 create kfa-db` + real `database_id`
in `wrangler.toml`, `wrangler kv namespace create CACHE` + id, then `npm run db:migrate:remote`.

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

**Scaffold status: live data; auth ON, credit deduction ON (Stripe OFF).** DataForSEO + RapidAPI HTTP calls and KV caching are implemented and working across search / deep-dive / reverse-asin. **D1 is wired** for the keyword-autosuggest dictionary AND the users/credits projection. **Clerk auth is ON** (tools gated, 50 free credits on signup) and **credits are now SPENT per action** (flat 1 each; see 2026-07-19c/d + 2026-07-20 session logs). The only thing not wired is buying more (Stripe). The flow (validate → cache → fetch → cache) is implemented end-to-end for `/api/search` as the reference pattern.

### ⭐ What's next (as of 2026-07-20, in dependency order)

1. **Stripe Checkout** — the money loop's last piece. Credit packs (`CREDIT_PACKS`) → Stripe Checkout → `/api/webhooks/stripe` (currently a stub) grants purchased credits via the same idempotent DO path (`grantOnce`/`grant`). Then wire an "out of credits" → buy CTA (the SPA already surfaces the 402 `INSUFFICIENT_CREDITS`).
2. **Production Clerk + deploy** — prod instance, `wrangler secret put CLERK_SECRET_KEY`/`CLERK_PUBLISHABLE_KEY`/`CLERK_WEBHOOK_SECRET`, real webhook endpoint in the Dashboard; plus the still-pending `wrangler d1 create` + `kv namespace create` + `db:migrate:remote`.
3. **Backlog:** `keyword_snapshots` §5 trend writes + the monthly cron refresh; the Niche Finder + BSR-history idea (memory `niche-finder-and-bsr-history-idea`); product items in `TODO.md`.

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
