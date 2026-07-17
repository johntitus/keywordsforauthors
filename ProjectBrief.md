# Keywords for Authors — Project Brief

A credit-based web app for Amazon KDP authors: find what book buyers search for,
see who's already ranking, and work backwards from competitors' books to the
keywords they own.

This document is the working context for the project. It records what's decided,
what's been verified against vendor documentation, and what's still open.

---

## 1. The product

Three tools that form a loop:

```
SEARCH a seed keyword  →  related keywords + Amazon search volumes
        ↓
DEEP DIVE a promising one  →  who ranks on page one, their ASINs
        ↓
REVERSE ASIN those books  →  the keywords those books actually rank for
        ↓
        └──────────→ back to SEARCH with better seeds
```

Each tool's output is the next tool's input. This is the core design property —
the product isn't a menu of three utilities, it's a research cycle. Anything that
breaks the handoff between steps (e.g. a deep dive that doesn't surface ASINs)
breaks the product.

**Scope: Amazon US, Books department. Fiction and nonfiction, print and ebook. **Deliberately narrow on market and category.

---

## 2. Data source

**DataForSEO** — pay-as-you-go, no monthly commitment, $50 minimum deposit.
Two different APIs are in play with _different billing models_:

| API                          | Billing                 | Used for             |
| ---------------------------- | ----------------------- | -------------------- |
| **DataForSEO Labs (Amazon)** | per task **+ per item** | search, reverse ASIN |
| **Merchant (Amazon)**        | per task **only**       | deep dive            |

That difference drives the whole cost model. Labs charges per keyword returned;
Merchant gives you the whole SERP for one flat task fee.

### Pricing (verify before relying on it)

- **Labs Amazon**: $0.012/task + $0.00012/item
  _The published pricing page still shows $0.01 / $0.0001. DataForSEO applied a
  +20% increase to all Labs endpoints in a recent update and at least one page
  reflects the new numbers. Budget the higher figure; confirm against your actual
  invoices._
- **Merchant Amazon Products/ASIN**: task-only.
  Live $0.005/SERP · Priority queue $0.003 · Standard queue $0.0015 (45 min turnaround)

Every response includes a `cost` field at both the top level and per task. **Read
it and log it** rather than estimating.

### Hard constraint on future markets

Labs Amazon endpoints support **US, Egypt, Saudi Arabia, and UAE only**. There is
no UK, DE, or CA. "Expand to other markets" means other _Amazon categories_, not
other countries — at least not through Labs. US is `location_code: 2840`.

---

## 3. The three calls

### 3.1 SEARCH — `dataforseo_labs/amazon/related_keywords/live`

Returns keywords from Amazon's "Related Searches" section, each with its own
`search_volume`. Depth-first walk from the seed.

**Params:** `keyword` (required, lowercase), `location_code`, `language_code`,
`depth` (0–4), `include_seed_keyword`, `ignore_synonyms`, `limit` (default 100,
max 1000), `offset`, `tag`

**Depth → max keywords:** 0 = seed only · 1 ≈ 6 · 2 ≈ 42 · 3 ≈ 258 · 4 ≈ 1554

**Decided: `depth: 3`, `limit: 258`, `ignore_synonyms: true`.** Depth 4 roughly
triples spend for keywords four hops from the seed — mostly noise. `ignore_synonyms`
strips near-duplicates for free.

**No `filters`. No `order_by`. No `department`.** Unlike the Google-side Labs
endpoints, this one takes none of them. There is no way to ask for book-only
related keywords — the endpoint mirrors Amazon's store-wide related searches.

**Work around it by seeding book-native language**: "stress management workbook"
returns a very different neighbourhood than "stress management." Filter the rest
client-side; it's just short strings.

**Returns per item:** `keyword`, `search_volume`, `last_updated_time`, `depth`,
and a nested `related_keywords` array.

**Cost:** $0.018 floor / ~$0.030 typical / $0.043 ceiling

---

### 3.2 REVERSE ASIN — `dataforseo_labs/amazon/ranked_keywords/live`

Keywords a given ASIN ranks for on Amazon.

**One ASIN per task** — `asin` is a single string, no plural form. Batch by
sending multiple task objects in one POST array (limits: 2000 calls/min, 30
simultaneous). Still billed per task.

**Params:** `asin` (required), `location_code`, `language_code`, `limit` (default
100, max 1000), `ignore_synonyms`, `filters` (max 8), `order_by` (max 3),
`offset`, `tag`

#### ⚠️ This endpoint is dangerous unfiltered

From DataForSEO's own documentation example — ASIN `B00R92CL5E`, a **NETGEAR WiFi
range extender**:

| Keyword                       | Volume | rank_absolute |
| ----------------------------- | ------ | ------------- |
| baby girl                     | 32,700 | 54            |
| car window stickers           | 20,900 | 53            |
| accessories for women jewelry | 18,700 | 34            |
| hunting gear for men          | 12,600 | 46            |

`total_count` was **11,789**. A WiFi extender does not rank for "baby girl" — it
appeared at position 54 on a broad SERP and the endpoint counted it. Shipping this
raw means telling KDP authors their book ranks for "baby girl."

**Mandatory server-side filter:**

```json
{
    "asin": "...",
    "location_code": 2840,
    "language_code": "en",
    "limit": 100,
    "ignore_synonyms": true,
    "filters": [
        ["ranked_serp_element.serp_item.rank_absolute", "<", 20],
        "and",
        ["keyword_data.keyword_info.search_volume", ">", 50]
    ],
    "order_by": ["keyword_data.keyword_info.search_volume,desc"]
}
```

The `rank_absolute < 20` threshold is the single highest-leverage number in the
product. **20 is a guess — tune it against real book ASINs before launch.**

Default sort is `rank_group asc`, not volume. Override it explicitly.

#### Payload bloat

Each item carries `keyword_data` _plus_ `ranked_serp_element.serp_item` — a
**complete product record repeated for every keyword**: title, url, description,
image_url, price, rating, votes_count, special_offers, delivery_info, xpath,
check_url, se_results_count. The same book title duplicated hundreds of times.

Extract `keyword`, `search_volume`, `rank_absolute`. Discard ~95%.

**Cost:** $0.013 floor / ~$0.016 typical / $0.024 ceiling **per ASIN**

Note: because the $0.012 task fee dominates, filtering hard barely saves money —
a call returning 5 keywords costs $0.013, one returning 100 costs $0.024. **Filter
for quality, not cost.**

---

### 3.3 DEEP DIVE — `merchant/amazon/products/live/advanced`

First page of Amazon Books results for one keyword.

**Params:** `keyword`, `department: "Books"`, `sort_by: "relevance"`, `location_code`

**Flat $0.005.** Task-only billing means you get the entire first page — 16 to 48
results depending on layout — for one fee. No per-item charge. This is the
cheapest action _and_ the most decision-relevant.

**Returns per result:** `rank_absolute`, `rank_group`, `title`, `asin`,
`price_from`, `price_to`, `currency`, `rating.value`, `rating.votes_count`,
`labels[]` (format: Paperback/Kindle/Audiobook/Hardcover/Cards), `is_best_seller`,
`is_amazon_choice`, `special_offers`, `image_url`, `url`.
SERP-level: `se_results_count`, `check_url`, `serp_item_types`, `last_updated_time`.

**Filter by element `type` before computing anything.** The response mixes
`amazon_serp` (organic), `amazon_paid` (sponsored), `editorial_recommendations`,
`top_rated_from_our_brands`, and `related_searches`. Averaging ads into a
competition metric is wrong. **Take `type == "amazon_serp"` only.**

**Free rider:** the `related_searches` element comes back inside this response at
no extra cost. No volumes attached, but `amazon_bulk_search_volume` prices them
cheaply ($0.012 + $0.00012/kw for up to 1000 keywords in one task). A second,
cheaper path to the core feature.

**Note:** `rating.value` is an **integer** in the schema (the docs example shows
`3` for a product with 68,918 votes). Don't build UI promising decimal stars until
verified against real book ASINs.

#### What deep dive computes

| Output              | How                                                        |
| ------------------- | ---------------------------------------------------------- |
| Competitors         | `se_results_count` — Books-scoped, therefore meaningful    |
| Avg reviews         | mean `rating.votes_count` over book-format organic results |
| Avg price           | mean `price_from`, same subset                             |
| Title density       | count of P1 titles containing the exact phrase             |
| Format distribution | tally `labels[]`                                           |
| **SERP purity**     | book-format organic results ÷ total organic results        |
| **The ASINs**       | feeds the reverse-ASIN step — this is the loop's hinge     |

**SERP purity is the most valuable output in the whole product** and no competitor
labels it. If "stress management" returns three books and seven blank journals,
the demand isn't book demand. It's free — just classifying titles.

---

## 4. Credit model

**Every action costs 1 credit.** Search = 1. Deep dive = 1. Reverse ASIN = 1 **per
ASIN** (paste ten, spend ten — reads as obvious, not as a rule).

Do not price actions differently even though underlying costs differ 6×. Variable
credit costs are what make credit systems confusing; users stop clicking things
when they don't know the price. Eat the variance.

### Blended cost per credit

| Usage mix                       | $/credit |
| ------------------------------- | -------- |
| Deep-dive heavy                 | $0.0095  |
| Loop-typical                    | $0.0148  |
| Search-heavy                    | $0.0226  |
| Pathological (all max searches) | $0.043   |

**Design number: $0.021/credit.**

**This is priced at the search-heavy rate deliberately, as a safety margin — it is
not loop-typical plus waste.** Loop-typical is $0.0148; a 5% waste allowance on
that would be $0.0155. $0.021 sits just under the search-heavy mix ($0.0226)
because §10.2 is genuinely open: if real users turn out search-heavy, the cost
model has to survive it. Pricing at the pessimistic mix means the open question
can't hurt you. If instrumentation shows loop-typical behaviour, this is
conservative by ~40% and there's room to discount.

### Pricing

Margins below are on **gross revenue**, net of Stripe (2.9% + 30¢) and API cost.

| Pack  | Price | $/credit | Stripe | API @ $0.021 | Net    | Margin  |
| ----- | ----- | -------- | ------ | ------------ | ------ | ------- |
| 100   | $12   | $0.12    | $0.65  | $2.10        | $9.25  | **77%** |
| 500   | $45   | $0.09    | $1.61  | $10.50       | $32.89 | **73%** |
| 2,000 | $120  | $0.06    | $3.78  | $42.00       | $74.22 | **62%** |

All clear healthy margin at **zero caching** and at the pessimistic usage mix. Even
the pathological user ($0.043/credit, all max searches) clears **25%** on the
biggest pack ($120 − $3.78 − $86.00 = $30.22) — rate limiting is for abuse, not
economics.

### Two open design tensions

**Free deep dive — don't file it under "costs nothing."** It's tempting: half a
cent, and it's the loop's hinge. But deep dive is the _cheapest_ action in the
blend. Making it free removes cheap credits from the denominator while you keep
paying for them, so cost per _charged_ credit goes **up**, not down.

Holding volume constant: loop-typical bills 16 credits at $0.015; the same
behaviour with free dives bills 12 credits for the same $0.24 of API spend —
**$0.020/charged credit.**

**But that's the floor, not the estimate.** The whole point of the lever is to
induce _more_ dives, and every extra one is $0.005 of spend against zero credits.
The real number rises with whatever elasticity you successfully create — i.e. the
better this works, the more it costs. That doesn't argue against it; it just means
it's a **marketing expense with a demand-dependent price**, not a freebie. Cost it
that way, and instrument dives-per-session so you can see what you actually bought.

**Reverse ASIN at 1 credit/ASIN collides with the loop.** A deep dive returns 16–48
ASINs, and the natural next gesture is "check these." At 10 credits a batch on a
100-credit pack, users hesitate at exactly the moment the loop is supposed to
close. The mental model (1 action = 1 credit) is right; the friction lands in the
wrong place. Worth exploring: default-select the top 3–5 ASINs rather than
all-or-nothing, or bundle the first batch after a deep dive at a flat rate.

### Free trial credits (proposed, not committed)

**50 free credits on signup. Costs ~$1.05 per signup at the $0.021 design number.**

| Scenario          | $/credit   | 50 credits |
| ----------------- | ---------- | ---------- |
| Deep-dive heavy   | $0.0095    | $0.48      |
| Loop-typical      | $0.0148    | $0.74      |
| **Design number** | **$0.021** | **$1.05**  |
| Pathological      | $0.043     | $2.15      |

**Budget the pessimistic end.** New users are structurally search-heavy: they type
seed keywords because they haven't learned the loop yet, and the loop is the part
that has to be taught. Loop-typical is what a trained user does, not what a trial
user does. $2.15 is a live worst case here, not a theoretical one.

**50 credits is roughly seven full cycles** (search 1 + deep dive 1 + 5-ASIN
reverse batch = 7 credits). That is enough to reach the loop at least once, which
is the only thing the trial has to accomplish. If §10.5 resolves toward bundling
the first post-deep-dive ASIN batch, recheck this arithmetic; the cycle cost
changes and so does the right trial size.

**Free signups are cache inventory, not pure loss.** They populate the KDP keyword
universe that paid users are later served from (§5, §7.1). Part of the $1.05 is an
asset. But the timing works against you: free credits are heaviest exactly when the
cache is emptiest. At 60% hit rate a trial costs

---

## 5. Caching — this is where the margin is

All three actions cache on a stable key:

- search → (seed, location, depth, ignore_synonyms)
- reverse ASIN → (asin, location, **filters**)
- deep dive → (keyword, department, location)

**⚠️ Sequencing:** including `filters` in the reverse-ASIN key is correct — different
filters are different queries — but §10.1 says the filter design is unsettled. Any
pre-launch tuning of the `rank_absolute` threshold or added relevance signals
**invalidates every cached reverse-ASIN row.** Settle §10.1 _before_ the cache
starts accruing, not after, or plan to throw the early cache away.

| Hit rate     | Effective $/credit |
| ------------ | ------------------ |
| 0% (launch)  | $0.021             |
| 30%          | $0.015             |
| 60% (mature) | $0.008             |

**Still charge a credit on a cache hit** — the user got their answer. Cached calls
are 100% margin.

`last_updated_time` on every keyword gives you the data's vintage for free.

### ⚠️ Cache TTL is not a deferred question — it's the trend cadence knob

**Caching and the snapshot table (below) are in direct tension, and the resolution
has to be deliberate.**

A cache hit means no fetch, which means **no new snapshot row**. So the trend table
does not fill at usage rate — it fills at whatever rate the TTL permits. And the
naive fix is worse than the problem: writing a snapshot row on a _cache hit_ would
manufacture fake flat trend lines out of stale volumes.

**Rules:**

1. **Write snapshots only on real fetches.** Never on cache hits.
2. **TTL determines trend granularity.** This is the whole relationship: a 30-day
   TTL means any keyword looked up at least monthly gets one sample per month.
3. **30 days is the recommended starting point.** Amazon volume data has real
   inertia, and monthly granularity is what BookBeam's trend column appears to
   show anyway. This is the happy case — 30-day TTL gives good margin _and_ the
   right sampling cadence, because you don't want a trend point per lookup.

The consequence to accept: **unpopular keywords get sparse trend history**, sampled
only as often as someone asks for them. But this is a _tail_ problem, not a general
one — see the head-term refresh below, which fixes it exactly where users look.
Design the UI for a ragged series ("3 data points over 5 months") on long-tail
keywords, and a clean monthly series on head terms.

### The head-term refresh — cheap, and it fixes the raggedness where it matters

§3.3 notes `amazon_bulk_search_volume`: **up to 1,000 keywords in a single task**,
billed $0.012 + $0.00012/keyword. Do the arithmetic:

> **1,000 keywords = $0.132/month = ~$1.58/year.**

A monthly scheduled refresh over a whitelist of your top ~1,000 head terms costs
about **a dollar sixty a year** and gives you a clean, uniform monthly trend series
precisely where demand concentrates. Usage-driven snapshots then fill in the long
tail opportunistically.

This is the resolution to the whole tension:

| Keyword segment       | Source                               | Cadence           |
| --------------------- | ------------------------------------ | ----------------- |
| Top ~1,000 head terms | scheduled `bulk_search_volume`       | uniform, monthly  |
| Long tail             | usage-driven snapshots on cache miss | ragged, on demand |

The cost is a rounding error against a single user's credit pack. **Build the
whitelist from your own search logs** — the head terms are, by definition, the ones
being looked up, and they're the ones a trend column will be judged on. Start the
job the week you launch; the whitelist can grow as the logs do.

### Snapshot every volume from day one

**Non-negotiable, and easy to skip.** Write `(keyword, search_volume, fetched_at)`
to a timestamped table **on every real fetch**, whether or not you display a trend
column.

DataForSEO has **no Amazon trend data at any price.** The Amazon Labs endpoints
return a single integer plus `last_updated_time`. There is no historical Amazon
endpoint in the catalogue. (Google has history — `google_historical_keyword_data`,
Google Trends — but that's Google curiosity, not Amazon buying intent. Never blend
them, never substitute one for the other.)

BookBeam's trend column (−70%, +41%, +138%) is almost certainly their own snapshot
history. It's not a feature you can buy — it's an asset that accrues. Six months of
this is the one column competitors have that you can't purchase. **The clock starts
when you write the first row.**

---

## 6. What BookProbe deliberately does not do

**No BSR. No sales estimates. No revenue.** BSR lives in
`merchant/amazon/asin/live/advanced` — a separate per-ASIN call at $0.005 each
(ten products = 5¢, an 11× jump on a deep dive).

This is a real gap, not a rounding error. **The product can tell you a shelf is
uncrowded but never whether anyone on it is earning.** Few competitors + healthy
royalties = opportunity. Few competitors + nobody earning = dead market. Keywords for authors
cannot distinguish these.

**Say so plainly in the UI.** "We show demand and competition, not sales estimates."
This audience has been sold false certainty by KDP course-sellers for a decade; a
tool that admits its limits is a competitive position. Treat BSR as the obvious
paid upgrade once demand is proven.

**Also unavailable:**

- Publication date → no "P1 Avg Age" (needs per-ASIN calls; don't)
- `se_results_count` from _ranked_keywords_ is whole-catalog, not Books-scoped —
  it counts candles and weighted blankets. Only the deep dive's Books-scoped
  version is meaningful. A number that looks like competition but isn't is worse
  than no number.

### Why BookBeam's grid costs what it costs

Every "P1" column needs one Merchant SERP call **per keyword**. Enriching a
258-keyword search: $1.29 live, or $0.39 on the standard queue. At 100
searches/month that's $129 or $39 per user. This is why BookBeam isn't $10/mo, and
why this app leads with search volume only.

**Architecture note:** the $0.0015 standard-queue price is quoted throughout for
comparison, but it is _not_ the assumed path. Standard queue is 45-minute
turnaround, which means `task_post` → `tasks_ready` → `task_get` (or a pingback
webhook) — a job queue, callback handling, and a UI that can show pending results.
**This app assumes Live mode at $0.005 throughout** and has no async
infrastructure specified. Standard queue is a real 3.3× saving if you ever build
batch/overnight enrichment, but it's an architecture decision, not a config flag.

The right shape is per-keyword deep dive on demand — the user spends attention
where it matters and you spend money only where they've signalled.

---

## 7. Positioning

**Books-only product, general-purpose code — but the hedge is thinner than it
sounds.**

`department` exists **only on the Merchant deep-dive call**. Labs `related_keywords`
and `ranked_keywords` have no such parameter — they're store-wide by nature and are
_already_ category-agnostic. So "make it a parameter, not a constant" is a one-line
change affecting one of three calls. Do it (it's free), but don't mistake it for a
pivot strategy: widening to other categories is mostly a UI, positioning, and
cache-economics decision, not a code one. The real lock-in is §5's cache and the
snapshot table, both of which are sized for a KDP-shaped keyword universe.

Ship a KDP-only UI. Market it as a KDP tool. Reasons:

1. **Caching depends on seed collision.** KDP is a small keyword universe — a few
   thousand niches, and head terms repeat across users. Open it to all
   of Amazon and the seed space explodes; hit rate craters; you pay $0.021/credit
   forever. **The narrow scope is the precondition for the margin, not a limit on it.**
2. **Competitive field.** General Amazon research = Helium 10, Jungle Scout
   ($40–100/mo, entrenched). KDP = BookBeam, Publisher Rocket, KDSpy — smaller,
   softer, and "built by someone who publishes" means something.
3. **The books-native insights stop making sense.** SERP purity (books vs. journals
   vs. oracle decks) and format distribution as a contamination meter are _books_
   signals. Meaningless in general FBA.

### Audience

Solo self-publishers and small indie presses, fiction and nonfiction, ~30-55, part writer part small-business owner. Price-sensitive, moderately technical, **deeply skeptical** —
burned by course-sellers and hype tools. Anything resembling get-rich-quick reads
as a red flag.

**Tone: a workbench, not a rocket ship.** Plain, competent, understated. Discovery
happens via Google ("book keyword research"), YouTube tutorials, r/selfpublish, and
Facebook groups. One recommendation in a thread carries real weight — the name and
the copy must survive being retyped from memory.

## 9. Affiliate program — not decided, explore later

**Status: brainstorm only. Nothing committed.** Recorded here so the reasoning
isn't lost.

BookBeam offers affiliates **25% lifetime commissions**. Matching that rate is
worth considering because affiliate is the one acquisition channel whose economics
actually fit this market: CAC has to stay under ~$5–8 for a bursty,
project-shaped audience, paid ads can't get near that, and the KDP world already
runs on YouTube tutorials, "best KDP tools" roundups, and Facebook group
recommendations. Those promoters exist and are already pushing BookBeam.

### Margin impact at 25%

At launch ($0.021/credit, no caching):

| Pack  | Gross | Stripe | API    | Affiliate | **Net** | **Margin** |
| ----- | ----- | ------ | ------ | --------- | ------- | ---------- |
| 100   | $12   | $0.65  | $2.10  | $3.00     | $6.25   | **52%**    |
| 500   | $45   | $1.61  | $10.50 | $11.25    | $21.65  | **48%**    |
| 2,000 | $120  | $3.78  | $42.00 | $30.00    | $44.22  | **37%**    |

At 60% cache hit rate ($0.008/credit):

| Pack  | API    | Affiliate | **Net** | **Margin** |
| ----- | ------ | --------- | ------- | ---------- |
| 100   | $0.80  | $3.00     | $7.55   | **63%**    |
| 500   | $4.00  | $11.25    | $28.15  | **63%**    |
| 2,000 | $16.00 | $30.00    | $70.22  | **59%**    |

Nothing goes underwater. **The 2,000 pack at launch (37%) is the thin spot** — and
it's the pack a motivated affiliate pushes hardest.

### Notes if this gets picked up

- **"Lifetime" means something different on credits.** BookBeam is a subscription;
  25% lifetime is 25% of a predictable monthly payment. On credit packs it's 25%
  of every repurchase — same structure, lumpier. Decide deliberately between first
  purchase only (cheapest, weakest pitch), 12 months (common compromise), or true
  lifetime (matches BookBeam, best recruiting line).
- **Possible structure: 30% first purchase / 15% recurring.** Out-recruits BookBeam
  on the number affiliates actually evaluate (the first-sale figure), costs less on
  whales, and avoids locking in 37% on the biggest pack before the real usage mix
  is known.
- **Affiliates and caching compound favourably.** Affiliate-driven growth means more
  users hitting the _same_ small KDP keyword universe, which lifts the cache hit
  rate — growth improves the economics that fund the growth. This only works
  because of the books-only scope (§7). It would not exist in general FBA.
- **⚠️ Self-referral is the real risk.** On a credit model, a 25% commission is a
  25% discount for anyone who signs up as their own affiliate — $30 instantly on a
  $120 pack, not a slow subscription leak. KDP forums will find this and share it.
  Requires same-payment-method / same-IP / same-email blocking from day one, plus a
  clawback window tied to the refund policy so commission isn't paid on purchases
  later refunded.
- **Affiliate software is fixed cost** (~$50–100/mo: Rewardful, FirstPromoter,
  Tapfiliate). Pure overhead until someone actually asks to promote the product.
  Defer.
- **Decide gross vs. net-of-Stripe.** Tables above assume gross, which is the
  industry norm.

---

## 10. Open questions

1. **`rank_absolute` filtering — the design is the question, not the number.**
   The filter is doing two jobs and only clearly succeeds at one. It removes junk
   in the NETGEAR case _because_ the junk happens to sit at rank 34–54 — i.e.
   you're using **rank depth as a proxy for topical relevance**. It's a decent
   proxy, but it fails both ways: a legitimate book at rank 22 for a real keyword
   gets cut identically to noise, and anything irrelevant that happens to rank
   shallow survives. So tuning isn't "find the right integer." It's: **is rank
   depth alone the right filter, or does it need a second signal alongside it** —
   title-token overlap with the keyword, category match, or a relevance score. Test
   against real book ASINs where you know the right answer. Highest-leverage
   unknown in the product — **and settle it before the cache accrues** (see §5),
   since `filters` is part of the reverse-ASIN cache key.
2. **Real usage mix** — the entire cost model rests on loop-typical behaviour. If
   users turn out search-heavy, cost/credit nearly doubles. **Instrument
   cost-per-call by action type from day one** and you'll know your true blended
   rate within a week of launch.
3. **`rating.value` precision** — integer per the schema. Verify against books.
4. **Actual first-page size** for Books. BookBeam's format-distribution counts sum
   to 15–33, implying ~16–48 slots. Confirm what the Merchant endpoint returns
   before labelling any column "P1 Avg."
5. **Reverse-ASIN pricing friction at the loop's hinge** (see §4). 1 credit/ASIN is
   the right mental model but puts a 10-credit decision at the exact moment the
   loop should close. Default-select 3–5? Bundle the first post-deep-dive batch?
   Worth resolving before launch, since it governs whether the loop actually loops.
6. **Churn** — the model's real risk, and unknowable from a spreadsheet. KDP
   research is bursty and project-shaped (subscribe, research three weeks, publish,
   cancel). Credits don't churn, which is much of why credits beat a subscription
   here. Still: the cheapest possible test is shipping and watching whether anyone
   buys a second pack.

---

## 11. Reference

- Labs Amazon pricing: https://dataforseo.com/pricing/dataforseo-labs/dataforseo-amazon-api
- Merchant Amazon pricing: https://dataforseo.com/pricing/merchant/amazon-api
- Related Keywords docs: https://docs.dataforseo.com/v3/dataforseo_labs/amazon/related_keywords/live/
- Ranked Keywords docs: https://docs.dataforseo.com/v3/dataforseo_labs/amazon/ranked_keywords/live/
- Merchant Amazon Products docs: https://docs.dataforseo.com/v3/merchant/amazon/products/live/advanced/
- Labs filters guide: https://docs.dataforseo.com/v3/dataforseo_labs/filters/
- ToS: https://dataforseo.com/terms-of-service
