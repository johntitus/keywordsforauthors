import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/react";
import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BrandMark } from "../components/BrandMark.js";

const tabs = [
  { to: "/search", label: "Keyword Search" },
  { to: "/deep-dive", label: "Competitors" },
  { to: "/reverse-asin", label: "Reverse ASIN" },
];

/**
 * The workbench chrome shared by the three tools. Matches the marketing landing
 * page's look (cream/clay palette, Poppins display, sticky blurred nav) so the
 * jump from home into a tool feels continuous.
 */
export function AppLayout() {
  const { pathname } = useLocation();

  // Reflect the active tool in the tab title, e.g. "Reverse ASIN - Keywords for Authors".
  useEffect(() => {
    const active = tabs.find((t) => pathname.startsWith(t.to));
    document.title = active ? `${active.label} - Keywords for Authors` : "Keywords for Authors";
  }, [pathname]);

  return (
    <div className="min-h-screen bg-cream font-sans text-ink antialiased">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-cream/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <NavLink to="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-display text-lg font-bold text-ink">Keywords for Authors</span>
          </NavLink>
          <div className="flex items-center gap-1 sm:gap-2">
            <nav className="flex items-center gap-1 sm:gap-2">
              {tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    [
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 sm:py-2",
                      isActive
                        ? "bg-clay-tint text-clay-dark"
                        : "text-muted hover:bg-black/5 hover:text-ink",
                    ].join(" ")
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-1 flex items-center gap-2 border-l border-black/10 pl-2 sm:ml-2 sm:pl-3">
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-black/5 hover:text-ink sm:px-4 sm:py-2">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-clay-dark sm:px-4 sm:py-2">
                    Sign up
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
