import type { PopularKeyword, SearchEvent } from "@kfa/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./db/client.js";
import { searchEvents, users } from "./db/schema.js";
import type { Env } from "./env.js";

/**
 * Usage analytics over the `search_events` log — "what are people searching for".
 * Writes are best-effort/fire-and-forget (call via waitUntil): D1 may be
 * unprovisioned and this must NEVER affect a tool response.
 */

export type SearchTool = "search" | "deep_dive";

/** Log one keyword-tool action. Keyword is normalized (trim/lowercase) so the
 * popular aggregation groups cleanly. Swallows all errors by design. */
export async function logSearchEvent(
  env: Env,
  userId: string,
  tool: SearchTool,
  keyword: string,
): Promise<void> {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return;
  try {
    await getDb(env).insert(searchEvents).values({ userId, tool, keyword: kw });
  } catch {
    // D1 unprovisioned / transient — analytics is non-critical.
  }
}

/** Top keywords by event count within the last `windowDays`, optionally scoped to
 * one tool. Returns keyword + total count + distinct-user count, busiest first. */
export async function popularKeywords(
  env: Env,
  windowDays: number,
  tool: SearchTool | null,
  now: number,
  limit = 100,
): Promise<PopularKeyword[]> {
  const since = new Date(now - windowDays * 86_400_000);
  const where = tool
    ? and(gte(searchEvents.createdAt, since), eq(searchEvents.tool, tool))
    : gte(searchEvents.createdAt, since);
  const rows = await getDb(env)
    .select({
      keyword: searchEvents.keyword,
      count: sql<number>`count(*)`,
      users: sql<number>`count(distinct ${searchEvents.userId})`,
    })
    .from(searchEvents)
    .where(where)
    .groupBy(searchEvents.keyword)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => ({
    keyword: r.keyword,
    count: Number(r.count),
    users: Number(r.users),
  }));
}

/** Recent individual events (newest first), optionally filtered to one user.
 * Left-joins the users projection so the UI can show an email, not just an ID. */
export async function recentEvents(
  env: Env,
  opts: { userId?: string; limit?: number } = {},
): Promise<SearchEvent[]> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const base = getDb(env)
    .select({
      id: searchEvents.id,
      userId: searchEvents.userId,
      email: users.email,
      tool: searchEvents.tool,
      keyword: searchEvents.keyword,
      createdAt: searchEvents.createdAt,
    })
    .from(searchEvents)
    .leftJoin(users, eq(users.id, searchEvents.userId))
    .orderBy(desc(searchEvents.createdAt))
    .limit(limit);
  const rows = await (opts.userId ? base.where(eq(searchEvents.userId, opts.userId)) : base);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    email: r.email || null,
    tool: r.tool,
    keyword: r.keyword,
    createdAt: r.createdAt ? r.createdAt.getTime() : 0,
  }));
}
