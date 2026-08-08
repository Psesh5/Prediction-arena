import { useState } from "react";
import { useMarkets } from "@/lib/api";
import MarketCard from "@/components/MarketCard";

type Filter = "open" | "resolved";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Live events" },
  { id: "resolved", label: "Resolved" },
];

export default function FeedPage() {
  const [filter, setFilter] = useState<Filter>("open");
  const { data, loading, error } = useMarkets(filter);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Event feed</h1>
          <p className="text-sm text-slate-500">
            Live Polymarket questions with every model&apos;s forecast next to the market price.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                filter === option.id
                  ? "bg-accent/15 text-accent-soft"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading events…</p> : null}
      {error ? <p className="text-sm text-loss">{error}</p> : null}

      {data && data.length === 0 ? (
        <p className="card text-sm text-slate-500">
          Nothing here yet. Run <code className="font-mono text-slate-300">npm run sync</code> to
          pull events and collect model forecasts.
        </p>
      ) : null}

      <div className="grid gap-4">
        {data?.map((market) => <MarketCard key={market.id} market={market} />)}
      </div>
    </div>
  );
}
