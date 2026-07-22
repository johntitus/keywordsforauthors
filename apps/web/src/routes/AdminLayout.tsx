import { NavLink, Outlet } from "react-router-dom";
import { useIsAdmin } from "../lib/useIsAdmin.js";

/**
 * Chrome for the admin area: the page heading + Users / Activity sub-tabs, with
 * the admin gate centralized here (the /api/admin/* endpoints are the real
 * enforcement; this just avoids rendering the tools to non-admins). Child routes
 * render through the <Outlet/>.
 */
const adminTabs = [
  { to: "/admin", label: "Users", end: true },
  { to: "/admin/activity", label: "Activity", end: false },
];

export function AdminLayout() {
  const { isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return <div className="py-24 text-center font-mono text-sm text-muted">Loading…</div>;
  }
  if (!isAdmin) {
    return (
      <section className="mx-auto mt-10 max-w-md rounded-2xl border border-black/5 bg-white/60 px-8 py-12 text-center shadow-sm">
        <h1 className="font-display text-2xl font-bold text-ink">Not authorized</h1>
        <p className="mt-3 text-sm text-muted">This area is for administrators only.</p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Admin</h1>
      <div className="mt-5 flex items-center gap-1 border-b border-black/10">
        {adminTabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              [
                "-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-clay text-clay-dark"
                  : "border-transparent text-muted hover:text-ink",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className="mt-6">
        <Outlet />
      </div>
    </section>
  );
}
