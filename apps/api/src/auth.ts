import { getAuth } from "@hono/clerk-auth";
import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "./env.js";

/**
 * Auth wiring for the Worker.
 *
 * `@hono/clerk-auth`'s `clerkMiddleware()` (applied in index.ts) verifies the
 * incoming session — an `Authorization: Bearer <jwt>` from the SPA (lib/api.ts)
 * or a Clerk session cookie — and stashes the result on the context.
 *
 * `attachUser` reads that result into our own `userId` context var so route
 * handlers (and, later, the CreditLedger DO) have one place to read identity.
 * It is intentionally NON-BLOCKING: signed-out requests get `userId = null` and
 * still run, because the tools are deliberately usable without login while
 * credits are off (see index.ts header + CLAUDE.md). Flip to enforcement with
 * `requireUser` once gating is turned on.
 */
export const attachUser: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const auth = getAuth(c);
  c.set("userId", auth?.userId ?? null);
  await next();
};

/**
 * Hard gate for a route/group: 401s signed-out requests. Not mounted yet — kept
 * ready so turning on auth for the tool endpoints is a one-line `app.use`.
 */
export const requireUser: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: "Sign in to continue", code: "UNAUTHENTICATED" as const }, 401);
  }
  c.set("userId", auth.userId);
  await next();
};
