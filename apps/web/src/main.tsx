import { ClerkProvider, useAuth } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "./index.css";
import { setTokenGetter } from "./lib/auth.js";
import { AdminPage } from "./routes/AdminPage.js";
import { AppLayout } from "./routes/AppLayout.js";
import { DeepDivePage } from "./routes/DeepDivePage.js";
import { HomePage } from "./routes/HomePage.js";
import { ProtectedRoute } from "./routes/ProtectedRoute.js";
import { ReverseAsinPage } from "./routes/ReverseAsinPage.js";
import { SearchPage } from "./routes/SearchPage.js";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  // Fail loud in dev rather than render a blank Clerk shell (see skill pitfalls).
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY — set it in apps/web/.env");
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } },
});

const router = createBrowserRouter([
  // Home = the full-bleed marketing landing (its own nav + footer).
  { path: "/", element: <HomePage /> },
  // The workbench tools share the tab-nav chrome, and require sign-in — the
  // ProtectedRoute swaps in a sign-in prompt (nav stays visible) when signed out.
  {
    element: <AppLayout />,
    children: [
      {
        element: <ProtectedRoute />,
        children: [
          { path: "search", element: <SearchPage /> },
          { path: "competitors", element: <DeepDivePage /> },
          { path: "reverse-asin", element: <ReverseAsinPage /> },
          // Admin is sign-in gated here (ProtectedRoute) and the /api/admin/*
          // endpoints enforce the email allowlist; the page renders "Not
          // authorized" for signed-in non-admins.
          { path: "admin", element: <AdminPage /> },
        ],
      },
    ],
  },
]);

/**
 * Bridges Clerk's hook-only `getToken` into the plain-fetch api layer (lib/api.ts
 * isn't a component, so it can't call useAuth). Mounted inside ClerkProvider; it
 * hands the current token-getter to the module-level accessor in lib/auth.ts.
 */
function ClerkTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <ClerkTokenBridge />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
);
