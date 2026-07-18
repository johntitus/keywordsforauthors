# Backlog / TODO

Deferred ideas captured so they aren't lost. Not committed to scope or timing.

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
