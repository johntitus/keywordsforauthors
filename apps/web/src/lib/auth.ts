/**
 * Module-level bridge so the plain-fetch api layer (lib/api.ts) can obtain the
 * current Clerk session JWT without being a React component. `ClerkTokenBridge`
 * in main.tsx registers Clerk's `getToken` here; api.ts calls `getAuthToken()`
 * before each request and attaches `Authorization: Bearer <jwt>` when present.
 *
 * Auth is not yet enforced server-side for the tool calls (credits still off),
 * so a null token simply means the request goes out unauthenticated.
 */
type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

export function setTokenGetter(fn: TokenGetter): void {
  tokenGetter = fn;
}

export async function getAuthToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  try {
    return await tokenGetter();
  } catch {
    return null;
  }
}
