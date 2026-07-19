import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env.js";
import * as schema from "./schema.js";

/**
 * Drizzle client over the D1 binding. D1 may be unprovisioned (the id in
 * wrangler.toml is a placeholder until `wrangler d1 create`), so every caller
 * treats DB access as best-effort — see the try/catch guards around keyword
 * indexing and suggestions in index.ts. The typeahead is a nice-to-have; it must
 * never break search.
 */
export const getDb = (env: Env) => drizzle(env.DB, { schema });
export type Db = ReturnType<typeof getDb>;
