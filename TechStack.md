# Keywords for Authors — Tech Stack Decision

Settled 2026-07-17. The stack for building the KeywordsForAuthors web app (see project
brief for the product itself). Chosen to stay simple, JS/TS-native, cheap to run
on bursty usage, and well-matched to the caching + snapshot economics in §5.

## The stack

| Layer                     | Choice                              | Why                                                                                                                                                   |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                  | **TypeScript** everywhere           | Types the large/trap-filled DataForSEO responses (§3.2 payload bloat); shared with the Worker via the monorepo                                        |
| Frontend framework        | **React** (Vite SPA)                | The app is a dense, stateful interactive tool, not a content site (Astro was considered and dropped)                                                  |
| Routing                   | **React Router**                    | Standard SPA routing (TanStack Router an option if type-safe routes wanted)                                                                           |
| Client data layer         | **TanStack Query**                  | Handles the core loop — each step's output feeds the next — plus client-side caching/refetch                                                          |
| Styling / UI              | **Tailwind + shadcn/ui**            | Standard React pairing; also what Claude design emits most cleanly                                                                                    |
| Compute / API             | **Cloudflare Workers + Hono**       | JS-native, scales to zero, cheap for bursty usage; Hono = routing + middleware + typed bindings                                                       |
| Relational + snapshot DB  | **D1** (SQLite) via **Drizzle ORM** | First-party, zero-config from Workers; workload is read-heavy + low-write so SQLite is comfortable. Drizzle doubles as the swappable repository layer |
| Cache                     | **Workers KV**                      | Holds DataForSEO responses on the §5 stable keys — this is where the margin is                                                                        |
| Consistency / idempotency | **Durable Objects**                 | Race-free credit deduction + §8.2 double-click idempotency (a DO per user serializes writes)                                                          |
| Scheduled jobs            | **Cron Triggers**                   | The monthly head-term `bulk_search_volume` refresh (§5)                                                                                               |
| Auth                      | **Clerk**                           | No first-party CF auth; Clerk = fast, React SDK + `@clerk/backend` on Workers + Hono middleware                                                       |
| Payments                  | **Stripe Checkout** (hosted)        | Simplest for credit packs; webhook on a Worker route. Elements is a later polish                                                                      |
| Validation                | **Zod**                             | API inputs + sanity-checking DataForSEO responses; shared frontend/backend                                                                            |
| Transactional email       | **Resend**                          | Signup verification + Stripe receipts; runs from Workers                                                                                              |
| Rate limiting             | **Cloudflare native** (or a DO)     | Covers §8.2 idempotency and the §9 self-referral abuse risk                                                                                           |
| Tooling / deploy          | **Wrangler** + **npm workspaces**   | Frontend and Worker share types and Zod schemas — most of why TS pays off. npm over pnpm (2026-07-17): already installed; workspaces cover this small repo fine                                                                             |

## Notable rejected options

- **Astro** — great for a marketing site/blog (and may still be worth it for the
  public SEO surface per §7), but wrong grain for the dense interactive app.
- **External Postgres (Neon) on day one** — considered for the snapshot table
  since it's the irreplaceable asset (§5), but D1 handles the low write volume
  fine. Kept swappable via the Drizzle repository layer; **Hyperdrive + Postgres**
  is the contained migration path if D1 is ever outgrown.
- **Next.js / Nuxt fullstack** — the API lives on a separate Worker instead, so a
  plain Vite SPA is enough.

## Integration seams to get right

- **Clerk → D1:** keep a `users` row keyed by Clerk user ID; credits/transactions
  hang off it. The **50 free trial credits (§4)** are provisioned via a Clerk
  **user-created webhook** that writes the D1 row and grants credits in one step.
- **Cache vs. snapshots (§5):** KV cache hit = no snapshot row. Snapshots (D1) are
  written **only on real fetches**. Settle the §10.1 `rank_absolute` filter design
  _before_ the reverse-ASIN cache accrues — `filters` is part of that cache key.
- **Cron refresh:** stays a standalone Worker regardless of frontend choices.

## Still open (stack-adjacent)

- Whether to stand up a separate **Astro marketing site** for the SEO-driven
  acquisition in §7 (independent of the app stack above).
- Testing approach (Vitest is the natural pick; not yet decided).
