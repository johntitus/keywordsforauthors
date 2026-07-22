import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/**
 * D1 schema (TechStack.md). Keep migrations in sync via `npm run db:generate`.
 */

// One row per Clerk user. Credits live here; the authoritative running balance
// is serialized through the CreditLedger Durable Object (§8.2) — this column is
// the durable projection the DO writes back.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // Clerk user ID
  email: text("email").notNull(),
  credits: integer("credits").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Ledger of every credit movement: signup grant, purchase, and per-action spend.
export const creditTransactions = sqliteTable(
  "credit_transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    delta: integer("delta").notNull(), // + grant/purchase, - spend
    reason: text("reason").notNull(), // 'signup' | 'purchase' | 'search' | 'deep_dive' | 'reverse_asin' | 'admin_grant'
    // Cost transparency (brief §10.2): log the real DataForSEO cost per action.
    apiCostUsd: real("api_cost_usd"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("credit_tx_user_idx").on(t.userId)],
);

// The irreplaceable asset (brief §5): timestamped volume history for Amazon,
// which DataForSEO does not sell. Write ONLY on real fetches, NEVER cache hits.
export const keywordSnapshots = sqliteTable(
  "keyword_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull(),
    searchVolume: integer("search_volume"),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("snapshot_keyword_idx").on(t.keyword, t.locationCode)],
);

// Autosuggest dictionary: one deduped row per keyword we've ever observed (seed
// searches + related + reverse-ASIN results), with its best-known volume. Powers
// the typeahead via a prefix lookup. Distinct from keyword_snapshots, which is
// the append-only trend history; this is a lookup index and is upserted freely
// (cache hits included) since it carries no time dimension.
export const keywords = sqliteTable(
  "keywords",
  {
    keyword: text("keyword").primaryKey(),
    searchVolume: integer("search_volume"),
    source: text("source"), // 'seed' | 'related' | 'reverse-asin'
    seenCount: integer("seen_count").notNull().default(1),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("keyword_prefix_idx").on(t.keyword)],
);

// Usage-analytics log: one row per keyword-tool action (Search seed / Competitors
// keyword), for the admin activity view ("what are people searching for", popular
// this week, per-user). Best-effort write on every such action (hit or miss) —
// distinct from `keywords` (a deduped dictionary) and `keyword_snapshots` (volume
// trend). No FK to users so a logging hiccup can never block a search.
export const searchEvents = sqliteTable(
  "search_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    tool: text("tool").notNull(), // 'search' | 'deep_dive'
    keyword: text("keyword").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("search_events_created_idx").on(t.createdAt),
    index("search_events_user_idx").on(t.userId),
    index("search_events_keyword_idx").on(t.keyword),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type KeywordSnapshot = typeof keywordSnapshots.$inferSelect;
export type KeywordEntry = typeof keywords.$inferSelect;
