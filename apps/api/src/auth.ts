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

/**
 * Gate for the /api/admin/* surface. Enforced SERVER-SIDE (the SPA can hide the
 * UI, but this is the real check): the signed-in user's Clerk email must be in
 * the `ADMIN_EMAILS` allowlist. The session JWT doesn't carry email, so we fetch
 * the user via the Clerk backend client (`c.get("clerk")`, set by clerkMiddleware)
 * and read the primary address the same way the webhook does.
 *
 * Fails closed: 401 signed-out, 403 when admin isn't configured, the email can't
 * be resolved, or it isn't on the list. The verified email is stashed on
 * `c.var.adminEmail` for the whoami endpoint.
 */
export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const userId = c.var.userId;
  if (!userId) {
    return c.json({ error: "Sign in to continue", code: "UNAUTHENTICATED" as const }, 401);
  }
  const allow = (c.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) {
    return c.json({ error: "Admin access is not configured", code: "FORBIDDEN" as const }, 403);
  }

  let email: string | null = null;
  try {
    const user = await c.get("clerk").users.getUser(userId);
    const primary =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    email = primary?.emailAddress?.toLowerCase() ?? null;
  } catch {
    email = null;
  }

  if (!email || !allow.includes(email)) {
    return c.json({ error: "Admin access required", code: "FORBIDDEN" as const }, 403);
  }
  c.set("adminEmail", email);
  await next();
};
