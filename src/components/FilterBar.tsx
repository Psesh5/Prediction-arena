import type { MarketCategory } from "@shared/types";

interface FilterBarProps {
  status: "open" | "resolved";
  onStatusChange: (status: "open" | "resolved") => void;
  category: MarketCategory | undefined;
  categories: MarketCategory[];
  onCategoryChange: (category: MarketCategory | undefined) => void;
  decidingToday: boolean;
  onDecidingTodayChange: (value: boolean) => void;
  withSignal: boolean;
  onWithSignalChange: (value: boolean) => void;
}

function chipClass(active: boolean): string {
  return `rounded-md px-3 py-1.5 text-sm transition-colors ${
    active ? "bg-accent/15 text-accent-soft" : "text-slate-400 hover:text-slate-100"
  }`;
}

export default function FilterBar({
  status,
  onStatusChange,
  category,
  categories,
  onCategoryChange,
  decidingToday,
  onDecidingTodayChange,
  withSignal,
  onWithSignalChange,
}: FilterBarProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1">
        <button
          type="button"
          onClick={() => onStatusChange("open")}
          className={chipClass(status === "open")}
        >
          Live events
        </button>
        <button
          type="button"
          onClick={() => onStatusChange("resolved")}
          className={chipClass(status === "resolved")}
        >
          Resolved
        </button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1">
        <button
          type="button"
          onClick={() => onCategoryChange(undefined)}
          className={chipClass(category === undefined)}
        >
          All categories
        </button>
        {categories.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onCategoryChange(option)}
            className={chipClass(category === option)}
          >
            {option}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onDecidingTodayChange(!decidingToday)}
        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
          decidingToday
            ? "border-accent/40 bg-accent/15 text-accent-soft"
            : "border-ink-700 bg-ink-900 text-slate-400 hover:text-slate-100"
        }`}
      >
        Decides in 24h
      </button>

      <button
        type="button"
        onClick={() => onWithSignalChange(!withSignal)}
        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
          withSignal
            ? "border-gain/40 bg-gain/10 text-gain"
            : "border-ink-700 bg-ink-900 text-slate-400 hover:text-slate-100"
        }`}
        title="Only events where a model's probability differs from the price by more than 5 points"
      >
        Trade signal
      </button>
    </div>
  );
}
