import { useState } from "react";
import type { MarketCategory } from "@shared/types";
import { useCategories, useLeaderboard } from "@/lib/api";
import { STARTING_BANKROLL } from "@shared/trading";
import { formatPercent, formatScore, formatSignedScore } from "@/lib/format";

const COLUMNS = [
  { key: "bankroll", label: "Bankroll", hint: `Units left of the ${STARTING_BANKROLL}u each model started with, sizing every bet itself.` },
  { key: "drawdown", label: "Max DD", hint: "Largest peak-to-trough fall in bankroll along the way." },
  { key: "return", label: "Flat return", hint: "Net units won or lost if every trade staked exactly 1 unit \u2014 sizing removed." },
  { key: "roi", label: "ROI", hint: "Net return divided by total staked." },
  { key: "trades", label: "Trades", hint: "Settled bets, taken when the model disagreed with the price by 5+ points." },
  { key: "hit", label: "Hit rate", hint: "Share of settled trades that paid out." },
  { key: "brier", label: "Brier", hint: "Mean squared forecast error across all resolved events. Lower is better." },
  { key: "accuracy", label: "Accuracy", hint: "Share of resolved events called on the right side of 50%." },
  { key: "edge", label: "Edge", hint: "Market Brier minus model Brier. Positive means better calibrated than the price." },
  { key: "open", label: "At risk", hint: "Units staked on events that have not settled yet." },
];

export default function LeaderboardPage() {
  const [category, setCategory] = useState<MarketCategory | undefined>();
  const { data: categories } = useCategories();
  const { data, loading, error } = useLeaderboard(category);

  const scored = data?.filter((row) => row.resolvedCount > 0) ?? [];
  const unscored = data?.filter((row) => row.resolvedCount === 0) ?? [];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-100">Model leaderboard</h1>
        <p className="text-sm text-slate-500">
          Every model starts with {STARTING_BANKROLL}u and sizes its own bets. When its
          probability beats the price by 5+ points it stakes the share of its bankroll it asked
          for, capped at 10% per event, and settles at the market odds.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 rounded-lg border border-ink-700 bg-ink-900 p-1">
        <button
          type="button"
          onClick={() => setCategory(undefined)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            category === undefined ? "bg-accent/15 text-accent-soft" : "text-slate-400"
          }`}
        >
          All categories
        </button>
        {(categories ?? []).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCategory(option)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              category === option ? "bg-accent/15 text-accent-soft" : "text-slate-400"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading leaderboard…</p> : null}
      {error ? <p className="text-sm text-loss">{error}</p> : null}

      {data && scored.length === 0 && !loading ? (
        <p className="card text-sm text-slate-500">
          No events have resolved yet, so no trades have settled. Forecasts are still being
          collected{unscored.length > 0 ? ` from ${unscored.length} models` : ""}.
        </p>
      ) : null}

      {scored.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-700">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-ink-900 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Model</th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className="px-4 py-3 text-right font-medium"
                    title={column.hint}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scored.map((row, index) => (
                <tr key={row.modelId} className="border-t border-ink-800 bg-ink-900/40">
                  <td className="px-4 py-3 font-mono text-slate-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">
                      {row.modelName}
                      {row.bust ? <span className="ml-2 pill border-loss/50 text-loss">bust</span> : null}
                    </div>
                    <div className="font-mono text-xs text-slate-500">{row.modelId}</div>
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      row.bankroll > STARTING_BANKROLL
                        ? "text-gain"
                        : row.bankroll < STARTING_BANKROLL
                          ? "text-loss"
                          : "text-slate-300"
                    }`}
                  >
                    {row.bankroll.toFixed(1)}u
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {row.maxDrawdown.toFixed(1)}u
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      row.totalReturn > 0
                        ? "text-gain"
                        : row.totalReturn < 0
                          ? "text-loss"
                          : "text-slate-300"
                    }`}
                  >
                    {formatSignedScore(row.totalReturn, 2)}u
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      row.roi > 0 ? "text-gain" : row.roi < 0 ? "text-loss" : "text-slate-300"
                    }`}
                  >
                    {row.trades === 0 ? "—" : formatPercent(row.roi, 1)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">{row.trades}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-100">
                    {row.trades === 0 ? "—" : formatPercent(row.tradeWinRate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-100">
                    {formatScore(row.brierScore)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-100">
                    {formatPercent(row.accuracy)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      row.edge > 0 ? "text-gain" : row.edge < 0 ? "text-loss" : "text-slate-300"
                    }`}
                  >
                    {formatSignedScore(row.edge)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {row.openStake}u
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {unscored.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-slate-400">Awaiting resolution</h2>
          <div className="flex flex-wrap gap-2">
            {unscored.map((row) => (
              <span key={row.modelId} className="pill bg-ink-900">
                <span className="text-slate-300">{row.modelName}</span>
                <span className="font-mono text-slate-500">
                  {row.openCount} open · {row.openStake.toFixed(1)}u at risk
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
