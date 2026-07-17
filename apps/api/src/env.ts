import type { CreditLedger } from "./credit-ledger.js";

/** Cloudflare bindings + secrets available to the Worker (see wrangler.toml). */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  CREDIT_LEDGER: DurableObjectNamespace<CreditLedger>;

  ENVIRONMENT: string;

  // Secrets (wrangler secret put / .dev.vars)
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
  CLERK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
}

/** Hono context variables set by middleware. */
export interface Variables {
  userId: string;
}
