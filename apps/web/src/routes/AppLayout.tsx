import { NavLink, Outlet } from "react-router-dom";
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
  return (
    <div className="min-h-screen bg-cream font-sans text-ink antialiased">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-cream/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <NavLink to="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-display text-lg font-bold text-ink">Keywords for Authors</span>
          </NavLink>
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
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
