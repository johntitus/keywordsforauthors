import { Link } from "react-router-dom";
import { BrandMark } from "../components/BrandMark.js";

/**
 * In-app home - a faithful React port of the marketing landing page
 * (landing/index.html). Full-bleed page with its own nav + footer (rendered
 * OUTSIDE the tool chrome in AppLayout). App-entry CTAs ("Start free", "Log in")
 * route into the workbench at /search; in-page nav stays as hash anchors.
 * Palette + fonts come from the theme tokens added in index.css.
 */

export function HomePage() {
  return (
    <div className="min-h-screen bg-cream font-sans text-ink antialiased">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-black/5 bg-cream/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-display text-lg font-bold text-ink">Keywords for Authors</span>
          </Link>
          <div className="hidden items-center gap-8 text-sm text-muted md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <Link to="/search" className="hover:text-ink">Log in</Link>
          </div>
          <Link to="/search" className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-clay-dark">
            Start free
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="bg-cream">
        <div className="mx-auto max-w-6xl px-6 pt-16 pb-20 md:pt-24">
          <div className="grid items-center gap-14 md:grid-cols-2">
            <div>
              <h1 className="font-display text-5xl font-bold leading-[1.05] text-ink md:text-6xl">
                Find what book buyers actually search for.
              </h1>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
                Keyword research for Amazon KDP authors. Real Amazon search volumes, the competition
                already ranking, and the keywords their books quietly own. No sales fantasies.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <Link to="/search" className="rounded-lg bg-clay px-6 py-3 font-semibold text-white shadow-sm hover:bg-clay-dark">
                  Start free
                </Link>
                <a href="#how" className="inline-flex items-center gap-1.5 font-medium text-clay hover:text-clay-dark">
                  See how it works
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </a>
              </div>
              <p className="mt-4 font-mono text-sm text-muted">50 credits, no card.</p>
            </div>

            {/* Sample result card */}
            <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_8px_40px_-12px_rgba(44,39,35,0.18)]">
              <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3.5">
                <div className="flex flex-1 items-center gap-2 text-muted">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <span className="font-mono text-sm text-ink">stress management</span>
                </div>
                <span className="whitespace-nowrap font-mono text-xs text-muted">US · Books</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-muted/70">
                    <th className="px-4 py-2.5 font-medium">Keyword</th>
                    <th className="px-4 py-2.5 font-medium">Volume</th>
                    <th className="px-4 py-2.5 font-medium">SERP purity</th>
                  </tr>
                </thead>
                <tbody className="text-[15px]">
                  {[
                    ["stress management journal", "4,300", "3/10 books"],
                    ["stress relief workbook", "2,900", "8/10 books"],
                    ["anxiety workbook adults", "6,100", "9/10 books"],
                    ["mindfulness for teens", "1,800", "6/10 books"],
                  ].map(([kw, vol, purity]) => (
                    <tr key={kw} className="border-t border-black/5">
                      <td className="px-4 py-3">{kw}</td>
                      <td className="px-4 py-3 font-mono text-muted">{vol}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-clay/25 bg-clay-tint px-2.5 py-0.5 font-mono text-xs text-clay-dark">
                          {purity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Three tools, one loop */}
      <section id="how" className="border-t border-black/5 bg-warm">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center">
            <h2 className="font-display text-4xl font-bold tracking-tight text-ink">Three tools, one loop.</h2>
            <p className="mt-3 text-lg text-muted">Each answer feeds the next. That's the whole method.</p>
          </div>

          {/* Loop diagram (md+) */}
          <div className="relative mx-auto mt-12 hidden md:block" style={{ maxWidth: "960px", height: "620px" }}>
            <p className="absolute left-1/2 top-0 w-[320px] -translate-x-1/2 text-center leading-relaxed text-muted">
              Start with a seed keyword. Get the related searches Amazon actually shows buyers, each
              with its US search volume.
            </p>
            <p className="absolute right-0 top-[320px] w-[240px] leading-relaxed text-muted">
              Pick a promising one. See who's on page one, how crowded it is, and whether it's really
              books ranking, or blank journals wearing a keyword.
            </p>
            <p className="absolute left-0 top-[320px] w-[240px] text-right leading-relaxed text-muted">
              Feed a competitor's book back in. Get the keywords that book actually ranks for, then
              seed a sharper search. One credit per ASIN you check.
            </p>

            <div className="absolute left-1/2 top-[80px] -translate-x-1/2" style={{ width: "520px", height: "470px" }}>
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 520 470" fill="none">
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M1 1 L9 5 L1 9 z" fill="#b5654a" />
                  </marker>
                </defs>
                <g stroke="#cd8468" strokeWidth={2} strokeDasharray="2 7" strokeLinecap="round" markerEnd="url(#arrow)">
                  <path d="M343.6 77.8 A178 178 0 0 1 437.9 241.2" />
                  <path d="M354.3 386 A178 178 0 0 1 165.7 386" />
                  <path d="M82.1 241.2 A178 178 0 0 1 165.7 84" />
                </g>
              </svg>

              {/* Center label */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                <svg className="mx-auto h-6 w-6 text-clay" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m17 2 4 4-4 4" />
                  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                  <path d="m7 22-4-4 4-4" />
                  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </svg>
                <div className="mt-2 font-mono text-[11px] uppercase tracking-widest text-muted">One loop</div>
                <div className="font-mono text-[11px] text-muted/70">sharper each pass</div>
              </div>

              {/* Node: Search */}
              <Link
                to="/search"
                className="absolute flex h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-black/5 bg-white shadow-[0_10px_30px_-10px_rgba(44,39,35,0.25)] transition-transform hover:scale-105"
                style={{ left: "50%", top: "18.1%" }}
              >
                <svg className="h-6 w-6 text-clay" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <div className="mt-0.5 font-mono text-[11px] text-muted">01</div>
                <div className="text-center font-display text-sm font-bold leading-tight text-ink">Keyword Search</div>
                <div className="mt-1 rounded-full bg-clay-tint px-2 py-0.5 font-mono text-[10px] text-clay-dark">1 credit</div>
              </Link>

              {/* Node: Deep dive */}
              <Link
                to="/deep-dive"
                className="absolute flex h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-black/5 bg-white shadow-[0_10px_30px_-10px_rgba(44,39,35,0.25)] transition-transform hover:scale-105"
                style={{ left: "75%", top: "66%" }}
              >
                <svg className="h-6 w-6 text-clay" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 18h8" />
                  <path d="M3 22h18" />
                  <path d="M14 22a7 7 0 1 0 0-14h-1" />
                  <path d="M9 14h2" />
                  <path d="M8 6h4v4a2 2 0 0 1-2 2 2 2 0 0 1-2-2Z" />
                  <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
                </svg>
                <div className="mt-0.5 font-mono text-[11px] text-muted">02</div>
                <div className="font-display text-sm font-bold text-ink">Competitors</div>
                <div className="mt-1 rounded-full bg-clay-tint px-2 py-0.5 font-mono text-[10px] text-clay-dark">1 credit</div>
              </Link>

              {/* Node: Reverse ASIN */}
              <Link
                to="/reverse-asin"
                className="absolute flex h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-black/5 bg-white shadow-[0_10px_30px_-10px_rgba(44,39,35,0.25)] transition-transform hover:scale-105"
                style={{ left: "25%", top: "66%" }}
              >
                <svg className="h-6 w-6 text-clay" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                  <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                </svg>
                <div className="mt-0.5 font-mono text-[11px] text-muted">03</div>
                <div className="font-display text-sm font-bold text-ink">Reverse ASIN</div>
                <div className="mt-1 whitespace-nowrap rounded-full bg-clay-tint px-2 py-0.5 font-mono text-[10px] text-clay-dark">1 / ASIN</div>
              </Link>
            </div>
          </div>

          {/* Stacked fallback (mobile) */}
          <div className="mt-10 grid gap-5 md:hidden">
            {[
              { n: "01", to: "/search", title: "Keyword Search", credit: "1 credit", blurb: "Start with a seed keyword. Get the related searches Amazon actually shows buyers, each with its US search volume." },
              { n: "02", to: "/deep-dive", title: "Competitors", credit: "1 credit", blurb: "Pick a promising one. See who's on page one, how crowded it is, and whether it's really books ranking, or blank journals wearing a keyword." },
              { n: "03", to: "/reverse-asin", title: "Reverse ASIN", credit: "1 / ASIN", blurb: "Feed a competitor's book back in. Get the keywords that book actually ranks for, then seed a sharper search. One credit per ASIN you check." },
            ].map((s) => (
              <Link key={s.to} to={s.to} className="rounded-xl border border-black/5 bg-white p-6">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-sm text-clay">{s.n} · {s.title}</div>
                  <span className="rounded-full bg-clay-tint px-2 py-0.5 font-mono text-[10px] text-clay-dark">{s.credit}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.blurb}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Signature insight */}
      <section className="border-t border-black/5 bg-cream">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-clay">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Signature insight
          </div>
          <h2 className="mt-5 font-display text-4xl font-bold leading-tight tracking-tight text-ink">
            We tell you when a “book” niche is really journals.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            If “stress management” returns three books and seven blank notebooks, the demand isn't
            book demand. SERP purity scores every search so you don't chase a shelf you can't
            actually compete on. Nobody else labels this.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-black/5 bg-warm">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-4xl font-bold tracking-tight text-ink">Pay for what you use.</h2>
            <p className="mt-3 text-lg leading-relaxed text-muted">
              Credits, not a subscription. Every action is one credit. Credits don't expire, so you
              can research hard for the three weeks around a launch and pay nothing for the months
              you're writing.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-black/5 bg-white p-7">
              <h3 className="font-medium text-muted">Starter pack</h3>
              <div className="mt-3 font-display text-5xl font-bold text-ink">$12</div>
              <p className="mt-2 font-mono text-sm text-muted">100 credits</p>
            </div>
            <div className="relative rounded-2xl border-2 border-clay bg-white p-7 shadow-[0_12px_40px_-16px_rgba(181,101,74,0.5)]">
              <span className="absolute -top-3 left-7 rounded-full bg-clay px-3 py-0.5 font-mono text-[11px] uppercase tracking-wider text-white">Best value</span>
              <h3 className="font-medium text-clay">Working pack</h3>
              <div className="mt-3 font-display text-5xl font-bold text-ink">$45</div>
              <p className="mt-2 font-mono text-sm text-muted">500 credits</p>
            </div>
            <div className="rounded-2xl border border-black/5 bg-white p-7">
              <h3 className="font-medium text-muted">Studio pack</h3>
              <div className="mt-3 font-display text-5xl font-bold text-ink">$120</div>
              <p className="mt-2 font-mono text-sm text-muted">2,000 credits</p>
            </div>
          </div>
          <p className="mt-8 text-center font-mono text-sm text-muted">Start with 50 free credits. No card required.</p>
        </div>
      </section>

      {/* Built for KDP */}
      <section className="border-t border-black/5 bg-cream">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Built for KDP publishers.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted">
            Amazon US, Books. Fiction and nonfiction, ebook and print. Narrow on purpose: the
            insights only make sense for books. Built by someone who publishes.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-black/5 bg-cream">
        <div className="mx-auto max-w-3xl px-6 pb-20">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Questions, answered plainly.</h2>
          <div className="mt-8 divide-y divide-black/5 border-y border-black/5">
            {[
              { q: "Is this another get-rich-quick tool?", a: "No. It shows data, not promises. If a niche is dead, we'll show you it's dead.", open: true },
              { q: "Why only Amazon US Books?", a: "Because staying narrow is what keeps it accurate. Signals like SERP purity and format mix only mean something for books." },
              { q: "Do credits expire?", a: "No. Buy a pack, use it whenever your next project needs it." },
              { q: "Can it tell me if a book is making money?", a: "No, and we say so plainly. We show demand and competition. Sales estimates are a different, noisier promise we won't fake." },
              { q: "Where does the data come from?", a: "Live Amazon search data, read fresh and timestamped so you know its vintage." },
            ].map((f) => (
              <details key={f.q} className="py-5" open={f.open}>
                <summary className="cursor-pointer list-none font-display font-semibold text-ink">{f.q}</summary>
                <p className="mt-2 leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-black/5 bg-warm">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center">
          <h2 className="font-display text-4xl font-bold tracking-tight text-ink">Start with 50 free credits.</h2>
          <div className="mt-7">
            <Link to="/search" className="inline-block rounded-lg bg-clay px-7 py-3.5 font-semibold text-white shadow-sm hover:bg-clay-dark">
              Start free
            </Link>
          </div>
          <p className="mt-4 font-mono text-sm text-muted">No card. No subscription. No hype.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/5 bg-cream">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-5 w-5 text-clay" />
              <span className="font-display text-lg font-bold text-ink">Keywords for Authors</span>
            </div>
            <p className="mt-3 max-w-xs leading-relaxed text-muted">
              Keyword research for Amazon KDP authors. A workbench, not a rocket ship.
            </p>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted/70">Product</div>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><a href="#how" className="hover:text-ink">How it works</a></li>
              <li><a href="#pricing" className="hover:text-ink">Pricing</a></li>
            </ul>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted/70">Company</div>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><a href="#" className="hover:text-ink">About</a></li>
              <li><a href="#" className="hover:text-ink">Contact</a></li>
            </ul>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-muted/70">Legal</div>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><a href="#" className="hover:text-ink">Terms</a></li>
              <li><a href="#" className="hover:text-ink">Privacy</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-black/5 py-6 text-center font-mono text-xs text-muted/70">
          © 2026 Keywords for Authors
        </div>
      </footer>
    </div>
  );
}
