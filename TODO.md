# Backlog / TODO

Deferred ideas captured so they aren't lost. Not committed to scope or timing.

## Admin tools — DEFERRED (noted 2026-07-20)

An **admin surface** gated to an **email allowlist** (starting with `john.titus@gmail.com`). v1:
- **List users** with their **credit balances** (email, credits, signup date).
- **Grant gratis credits** to any user (comps/support).

Sketch: a `requireAdmin` middleware (like `requireUser` + an `ADMIN_EMAILS` env allowlist; **enforce
server-side**, and note the session JWT doesn't carry email by default — fetch via the Clerk client or
add it to the token claims). `GET /api/admin/users` reads the D1 `users` projection; `POST
/api/admin/users/:id/grant` uses the DO's **existing `grant()`** + a `credit_transactions` row (new
`reason: 'admin_grant'`). Admin-only `/admin` SPA route later; could ship API-first. Will accrete more
(usage analytics, refunds, disable users). See memory `admin-tools-backlog`.

## Relevance sort for related keywords — DEFERRED (noted 2026-07-18)

Sort/filter a Search's related keywords by **how many books actually rank for
them** (book-coverage) instead of by `depth` (which is only semantic distance
from the seed and a weak relevance proxy). This is SERP purity repurposed as a
keyword-relevance signal — the right signal for this product.

Two cache-derived sources answer "how many books rank for term X":
1. **Deep-dive cache** (keyword → books SERP) — gives SERP purity directly, but
   only for keywords already deep-dived.
2. **Inverted reverse-ASIN index** (the better one): every reverse-ASIN call
   yields "book B ranks for keywords […]". Invert to `keyword → {books}` and you
   get "N known books rank for this," already book-native. Compounds with usage.

Architecture notes:
- Lives in the **cache/index layer, specifically D1**, not KV — KV can't answer
  "which keywords map to books." Write a queryable `keyword_book_rank(keyword,
  asin, rank_absolute, fetched_at)` table on every reverse-ASIN / deep-dive
  response; "sort by relevance" = a D1 join against it.
- **Store raw `rank_absolute`** so the unsettled §10.1 threshold can be retuned
  in-app without refetching.

Caveats (don't overclaim to a skeptical audience):
- **Cold start** — empty at launch (worst when trial users are heaviest);
  must degrade gracefully to depth/unsorted, show "—" not a fake 0.
- **Absence ≠ irrelevance** — "0 books in cache" usually means nobody's
  researched it yet. Present as *book coverage*, never a completeness-implying
  "relevance score."

## Junk / off-target keyword filtering — DEFERRED (noted 2026-07-18)

Related-keywords mirrors Amazon's store-wide related searches, so seeds drift
into obviously off-target terms KDP users don't want (verified in datavet:
"stress management" → magnesium glycinate/ashwagandha; "journal" → pens,
highlighters, school supplies). Need a filter for terms that are clearly not
book search intent.

Approaches to evaluate: simple blocklist/stopword pass · a category signal ·
or reuse the book-coverage signal above (a term no book ranks for is a filter
candidate). Undecided — capture data first via the datavet tool.

## Search Filters/Options component — DEFERRED (noted 2026-07-19)

A user-facing **Filters/Options panel on the keyword Search page** so users can
narrow the (now always-on) full-path results themselves instead of us deciding
for them. Motivating case: competitor mining for "stress management for women"
pulls in **coloring-book / journal / planner** vocabulary (and some non-English
terms) — we deliberately do NOT hard-exclude those in the pipeline, because some
authors genuinely target "coloring book" / "journal" niches. Let the user toggle:
- exclude off-genre formats (coloring / journal / planner / notebook)
- English-only keywords
- min search volume · relevance tier (High/Med/Low) · source (related vs competitor)

Client-side filter over the returned list to start (no extra API cost). This is
the agreed alternative to hard-filtering in the mining step (decided 2026-07-19).

## Per-keyword "indexed results" (real competition count) — DEFERRED (noted 2026-07-19)

Show, per keyword in a Search, the **# of indexed Amazon results** — the
`total_products` number the deep-dive already surfaces as its top widget (e.g.
"stress management for kids" → 203). This is the TRUE competition count the user
wants (distinct from the co-occurrence/overlap "Books" column, which only counts
how many of the seed's ~15 mined books also rank for the term).

Cost shape (why deferred, and why it may still be worth it):
- Requires **1 RapidAPI product search per keyword** — a mini-deep-dive on every
  row (~250 calls/search cold, rate-limited → ~1–2 min). Turns a 1-credit search
  into many; that's the cost the deep-dive step exists to isolate.
- BUT each call is **cached per keyword (reuse the `deepdive:*` cache)**, so it
  **rapidly warms the deep-dive cache** — first call expensive, repeats ≈ free.
  Over time this could pay for itself and make later real deep-dives instant.
  User's read: "may be worth it… quickly expands our cache."

Bounding options when we build it: top-N by relevance/volume (auto) · progressive
lazy-fill like the deep-dive BSR column · on-demand per-row button. Freebie we can
add anytime at zero cost: the **seed's own** indexed count (the `total_products`
from the seed search we currently discard) as a top-of-page widget.
