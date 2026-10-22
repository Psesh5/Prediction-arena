import { useState } from "react";
import type { MarketCategory } from "@shared/types";
import { useCategories, useMarkets } from "@/lib/api";
import MarketCard from "@/components/MarketCard";
import FilterBar from "@/components/FilterBar";

export default function FeedPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [category, setCategory] = useState<MarketCategory | undefined>();
  const [decidingToday, setDecidingToday] = useState(false);
  const [withSignal, setWithSignal] = useState(false);

  const { data: categories } = useCategories();
  const { data, loading, error } = useMarkets({ status, category, decidingToday, withSignal });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-100">Event feed</h1>
        <p className="text-sm text-slate-500">
          Live Polymarket questions with every model&apos;s forecast next to the market price.
        </p>
      </div>

      <FilterBar
        status={status}
        onStatusChange={setStatus}
        category={category}
        categories={categories ?? []}
        onCategoryChange={setCategory}
        decidingToday={decidingToday}
        onDecidingTodayChange={setDecidingToday}
        withSignal={withSignal}
        onWithSignalChange={setWithSignal}
      />

      {loading ? <p className="text-sm text-slate-500">Loading events…</p> : null}
      {error ? <p className="text-sm text-loss">{error}</p> : null}

      {data && data.length === 0 && !loading ? (
        <p className="card text-sm text-slate-500">
          No events match these filters. Run{" "}
          <code className="font-mono text-slate-300">npm run sync</code> to pull more events and
          collect model forecasts.
        </p>
      ) : null}

      <div className="grid gap-4">
        {data?.map((market) => <MarketCard key={market.id} market={market} />)}
      </div>
    </div>
  );
}
