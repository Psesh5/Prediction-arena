import { NavLink, Outlet } from "react-router-dom";
import { useStats } from "@/lib/api";

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-accent/15 text-accent-soft" : "text-slate-400 hover:text-slate-100"
  }`;

export default function Layout() {
  const { data: stats } = useStats();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="text-base font-semibold tracking-tight text-slate-100">
              Prediction<span className="text-accent"> Arena</span>
            </NavLink>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={linkClass}>
                Event feed
              </NavLink>
              <NavLink to="/leaderboard" className={linkClass}>
                Leaderboard
              </NavLink>
            </nav>
          </div>

          {stats ? (
            <div className="hidden gap-4 font-mono text-xs text-slate-500 sm:flex">
              <span>{stats.models} models</span>
              <span>{stats.markets} events</span>
              <span>{stats.predictions} forecasts</span>
              <span>{stats.resolvedMarkets} resolved</span>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
