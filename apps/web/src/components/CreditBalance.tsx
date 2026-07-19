import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * Live credit balance pill for the nav. Only queries when signed in (the
 * /api/credits endpoint is gated). Deduction isn't wired yet, so this holds at
 * the 50-credit signup grant for now — but the UI (including the out-of-credits
 * state) is ready for when spending turns on.
 */
export function CreditBalance() {
  const { isSignedIn } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["credits"],
    queryFn: api.credits,
    enabled: !!isSignedIn,
    staleTime: 30 * 1000,
  });

  const credits = data?.credits;
  const empty = credits === 0;

  return (
    <span
      title="Credits remaining"
      className={[
        "hidden rounded-lg px-2.5 py-1.5 text-sm font-medium tabular-nums sm:inline-flex sm:items-center sm:gap-1.5",
        empty ? "bg-clay-tint text-clay-dark" : "text-muted",
      ].join(" ")}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v10M9.5 9.5h3.25a1.75 1.75 0 010 3.5H10m-.5 0h3.25a1.75 1.75 0 010 3.5H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {isLoading || credits == null ? "—" : `${credits.toLocaleString()} credits`}
    </span>
  );
}
