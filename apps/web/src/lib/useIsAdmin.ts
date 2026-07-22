import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

/**
 * True when the signed-in user passes the server-side admin allowlist. Backed by
 * GET /api/admin/me — a 200 means admin, a 403 (ApiError) means not. Used to
 * reveal the /admin nav link and route without hard-coding emails in the client
 * (the server is still the real gate; this only decides what UI to show).
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { isSignedIn } = useAuth();
  const q = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.admin.me(),
    enabled: !!isSignedIn,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return { isAdmin: q.isSuccess, isLoading: !!isSignedIn && q.isLoading };
}
