import type { CreditLedger } from "./credit-ledger.js";

/** Cloudflare bindings + secrets available to the Worker (see wrangler.toml). */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  CREDIT_LEDGER: DurableObjectNamespace<CreditLedger>;
  // Static-asset binding — the built Vite SPA (see wrangler.toml [assets]). The
  // catch-all route serves index.html through this for SPA client routing.
  ASSETS: Fetcher;

  ENVIRONMENT: string;

  // Secrets (wrangler secret put / .dev.vars)
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
  // RapidAPI real-time-amazon-data — powers the deep dive (BSR hybrid, 2026-07-18).
  RAPIDAPI_KEY: string;
  // Clerk — session verification (@hono/clerk-auth reads both from env).
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  // Svix signing secret for the Clerk user.created webhook (whsec_…). Optional
  // until the webhook is wired.
  CLERK_WEBHOOK_SECRET?: string;
  // Comma-separated allowlist of admin emails (e.g. "john.titus@gmail.com").
  // Gates the /api/admin/* surface (requireAdmin). Optional — unset ⇒ admin off.
  ADMIN_EMAILS?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
}

/** Hono context variables set by middleware. */
export interface Variables {
  // The authenticated Clerk user ID, or null when the request is signed-out.
  // Populated by the auth middleware from a verified session JWT.
  userId: string | null;
  // The verified admin email, set by requireAdmin once the allowlist check
  // passes (only present on /api/admin/* requests).
  adminEmail?: string;
}
