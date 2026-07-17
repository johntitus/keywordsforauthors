import { Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="min-h-screen text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-semibold tracking-tight">Keywords for Authors</span>
          <span className="text-sm text-slate-500">A workbench, not a rocket ship.</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
