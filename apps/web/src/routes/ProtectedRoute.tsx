import { SignInButton, SignUpButton, useAuth } from "@clerk/react";
import { Outlet } from "react-router-dom";

/**
 * Gate for the workbench tools. Renders inside AppLayout, so the nav chrome
 * stays put while the tool area swaps to a sign-in prompt for signed-out users.
 * Mirrors the server-side `requireUser` gate on the tool endpoints — the API
 * would 401 these requests anyway; this just makes it a friendly wall, not a
 * broken-looking error.
 */
export function ProtectedRoute() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted">Loading…</div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-black/5 bg-white/60 px-8 py-12 text-center shadow-sm">
        <h1 className="font-display text-2xl font-bold text-ink">Sign in to use the workbench</h1>
        <p className="mt-3 text-sm text-muted">
          Keyword Search, Competitors, and Reverse ASIN are for signed-in authors. New accounts get
          50 free credits.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <SignUpButton mode="modal">
            <button className="rounded-lg bg-clay px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-clay-dark">
              Create account
            </button>
          </SignUpButton>
          <SignInButton mode="modal">
            <button className="rounded-lg px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-black/5 hover:text-ink">
              Sign in
            </button>
          </SignInButton>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
