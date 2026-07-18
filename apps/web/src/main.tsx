import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "./index.css";
import { AppLayout } from "./routes/AppLayout.js";
import { DeepDivePage } from "./routes/DeepDivePage.js";
import { HomePage } from "./routes/HomePage.js";
import { ReverseAsinPage } from "./routes/ReverseAsinPage.js";
import { SearchPage } from "./routes/SearchPage.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } },
});

const router = createBrowserRouter([
  // Home = the full-bleed marketing landing (its own nav + footer).
  { path: "/", element: <HomePage /> },
  // The workbench tools share the tab-nav chrome.
  {
    element: <AppLayout />,
    children: [
      { path: "search", element: <SearchPage /> },
      { path: "deep-dive", element: <DeepDivePage /> },
      { path: "reverse-asin", element: <ReverseAsinPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
