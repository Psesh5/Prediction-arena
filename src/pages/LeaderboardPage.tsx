import { useLeaderboard } from "@/lib/api";
import { formatPercent, formatScore, formatSignedScore } from "@/lib/format";

const COLUMNS = [
  { key: "brier", label: "Brier", hint: "Mean squared error of the forecast. Lower is better." },
  { key: "accuracy", label: "Accuracy", hint: "Share of resolved events called correctly." },
  { key: "edge", label: "Edge vs market", hint: "Market Brier minus model Brier. Positive beats the crowd." },
  { key: "beat", label: "Beat market", hint: "Share of events where the model scored better than the price." },
  { key: "confidence", label: "Avg confidence", hint: "How far from 50/50 the model tends to sit." },
  { key: "resolved", label: "Resolved", hint: "Scored forecasts backing these numbers." },
];

export default function LeaderboardPage() {
  const { data, loading, error } = useLeaderboard();
  const scored = data?.filter((row) => row.resolvedCount > 0) ?? [];
  const unscored = data?.filter((row) => row.resolvedCount === 0) ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">Model leaderboard</h1>
        <p className="text-sm text-slate-500">
          Ranked by Brier score across resolved events, with the market price as the benchmark.
        </p>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading leaderboard…</p> : null}
      {error ? <p className="text-sm text-loss">{error}</p> : null}

      {data && scored.length === 0 && !loading ? (
        <p className="card text-sm text-slate-500">
          No events have resolved yet, so nothing is scored. Forecasts are still being collected
          {unscored.length > 0 ? ` for ${unscored.length} models` : ""}.
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
                  <th key={column.key} className="px-4 py-3 text-right font-medium" title={column.hint}>
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
                    <div className="font-medium text-slate-100">{row.modelName}</div>
                    <div className="font-mono text-xs text-slate-500">{row.modelId}</div>
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
                  <td className="px-4 py-3 text-right font-mono text-slate-100">
                    {formatPercent(row.beatMarketRate)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {formatPercent(row.averageConfidence)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {row.resolvedCount}
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
                <span className="font-mono text-slate-500">{row.openCount} open</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
