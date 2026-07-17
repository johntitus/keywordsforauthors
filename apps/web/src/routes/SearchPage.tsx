import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api.js";

/**
 * Step 1 of the loop (brief §1): seed keyword -> related keywords + volumes.
 * Deliberately minimal — the marketing landing page lives elsewhere; this is
 * the in-app workbench. Deep dive / reverse ASIN pages follow the same pattern.
 */
export function SearchPage() {
  const [seed, setSeed] = useState("");
  const search = useMutation({ mutationFn: (kw: string) => api.search(kw) });

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <p className="mt-1 text-slate-600">
        Start with a seed keyword. Get the related searches Amazon shows buyers, each with
        its US search volume.
      </p>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (seed.trim()) search.mutate(seed.trim().toLowerCase());
        }}
      >
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          placeholder="stress management"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
        />
        <button
          type="submit"
          disabled={search.isPending}
          className="rounded-md bg-slate-800 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {search.isPending ? "Searching…" : "Search · 1 credit"}
        </button>
      </form>

      {search.isError && (
        <p className="mt-4 text-sm text-red-600">{search.error.message}</p>
      )}

      {search.data && (
        <div className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            <span>US · Books · {search.data.keywords.length} keywords</span>
            <span>{search.data.cached ? "cached" : "fresh"}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Keyword</th>
                <th className="px-4 py-2 font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {search.data.keywords.map((k) => (
                <tr key={k.keyword} className="border-t border-slate-100">
                  <td className="px-4 py-2">{k.keyword}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {k.searchVolume?.toLocaleString() ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
