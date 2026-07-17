import { defineConfig } from "drizzle-kit";

// Generates SQL migrations into ./drizzle, applied to D1 via wrangler
// (`npm run db:migrate:local` / `:remote`).
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
