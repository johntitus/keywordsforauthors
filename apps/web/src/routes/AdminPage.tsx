import type { AdminUser } from "@kfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

/**
 * Admin → Users tab. Lists every user with their credit balance + signup date,
 * grants gratis credits (comps/support), and links each user to their activity.
 * Rendered inside AdminLayout, which owns the heading, tabs, and admin gate.
 */

const fmtDate = (ms: number | null) =>
  ms == null
    ? "—"
    : new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function GrantCell({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("50");
  const grant = useMutation({
    mutationFn: (n: number) => api.admin.grant(user.id, n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
  });

  const n = Number(amount.replace(/[^0-9]/g, ""));
  const valid = amount.trim() !== "" && Number.isFinite(n) && n >= 1;

  return (
    <div className="flex items-center justify-end gap-2">
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && valid && grant.mutate(n)}
        className="w-20 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-right text-sm outline-none focus:border-clay"
        aria-label={`Credits to grant ${user.email}`}
      />
      <button
        type="button"
        disabled={!valid || grant.isPending}
        onClick={() => grant.mutate(n)}
        className="rounded-lg bg-clay px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-clay-dark disabled:opacity-50"
      >
        {grant.isPending ? "Granting…" : "Grant"}
      </button>
      {grant.isError && (
        <span className="font-mono text-[11px] text-clay-dark" title={(grant.error as Error).message}>
          failed
        </span>
      )}
    </div>
  );
}

export function AdminPage() {
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.admin.users(),
    retry: false,
  });
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const list = usersQuery.data?.users ?? [];
    const q = filter.trim().toLowerCase();
    return q ? list.filter((u) => u.email.toLowerCase().includes(q) || u.id.includes(q)) : list;
  }, [usersQuery.data, filter]);

  const total = usersQuery.data?.users.length ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Filter by email or user ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="min-w-[240px] flex-1 rounded-lg border border-black/10 bg-white px-3 py-2.5 text-[15px] outline-none focus:border-clay"
        />
        <button
          type="button"
          onClick={() => usersQuery.refetch()}
          disabled={usersQuery.isFetching}
          className="rounded-lg border border-black/15 bg-white px-4 py-2.5 font-mono text-xs text-ink transition-colors hover:bg-black/5 disabled:opacity-50"
        >
          {usersQuery.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {usersQuery.isError && (
        <p className="mt-4 text-sm text-clay-dark">{(usersQuery.error as Error).message}</p>
      )}

      {usersQuery.isLoading ? (
        <p className="mt-8 font-mono text-sm text-muted">Loading users…</p>
      ) : (
        <div className="mt-6 rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-16px_rgba(44,39,35,0.15)]">
          <div className="border-b border-black/5 px-4 py-3 font-mono text-xs text-muted">
            {filter ? `${rows.length} of ${total}` : `${total}`} user{total === 1 ? "" : "s"}
          </div>
          <div className="overflow-x-auto rounded-b-2xl">
            <table className="w-full min-w-[720px] text-[15px]">
              <thead className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">User ID</th>
                  <th className="px-4 py-2.5 text-right font-medium">Credits</th>
                  <th className="px-4 py-2.5 font-medium">Signed up</th>
                  <th className="px-4 py-2.5 font-medium" />
                  <th className="px-4 py-2.5 text-right font-medium">Grant credits</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-t border-black/5 hover:bg-warm/40">
                    <td className="px-4 py-3 text-ink">{u.email || <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{u.id}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink">{u.credits.toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{fmtDate(u.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/activity?user=${encodeURIComponent(u.id)}`}
                        className="whitespace-nowrap font-mono text-xs text-clay-dark hover:underline"
                      >
                        Activity →
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <GrantCell user={u} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr className="border-t border-black/5">
                    <td colSpan={6} className="px-4 py-6 text-center font-mono text-sm text-muted">
                      {total === 0 ? "No users yet." : "No users match that filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
