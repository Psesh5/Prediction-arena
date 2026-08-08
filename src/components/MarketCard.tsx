import { Link } from "react-router-dom";
import type { MarketWithPredictions, Prediction } from "@shared/types";
import { consensusProbability } from "@shared/scoring";
import { expectedValue, tradeSignal } from "@shared/trading";
import { formatPercent, formatVolume, timeUntil } from "@/lib/format";
import ProbabilityBar from "./ProbabilityBar";
import TradeBadge from "./TradeBadge";

function predictionTone(market: MarketWithPredictions, prediction: Prediction): string {
  if (market.status !== "resolved" || prediction.isCorrect === null) return "text-slate-300";
  return prediction.isCorrect ? "text-gain" : "text-loss";
}

/** The single most valuable disagreement between a model and the price. */
function bestSignal(market: MarketWithPredictions) {
  return market.predictions
    .map((prediction) => ({
      prediction,
      signal: tradeSignal(prediction.probability, market.marketProbability),
    }))
    .filter((entry): entry is { prediction: Prediction; signal: NonNullable<typeof entry.signal> } =>
      entry.signal !== null
    )
    .sort((a, b) => expectedValue(b.signal) - expectedValue(a.signal))
    .at(0);
}

interface MarketCardProps {
  market: MarketWithPredictions;
}

export default function MarketCard({ market }: MarketCardProps) {
  const consensus = consensusProbability(market.predictions);
  const isResolved = market.status === "resolved";
  const best = isResolved ? undefined : bestSignal(market);

  return (
    <article className="card transition-colors hover:border-ink-600">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to={`/markets/${market.id}`}
            className="text-base font-semibold leading-snug text-slate-100 hover:text-accent-soft"
          >
            {market.question}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="pill text-slate-400">{market.category}</span>
            {best ? (
              <TradeBadge signal={best.signal} label={best.prediction.modelName} />
            ) : null}
          </div>
        </div>
        <span
          className={`pill shrink-0 ${
            isResolved
              ? market.resolvedOutcome === "YES"
                ? "border-gain/40 text-gain"
                : "border-loss/40 text-loss"
              : "text-slate-400"
          }`}
        >
          {isResolved ? `Resolved ${market.resolvedOutcome}` : timeUntil(market.endDate)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Market</p>
          <p className="font-mono text-lg text-slate-100">
            {formatPercent(market.marketProbability)}
          </p>
          {market.marketProbability !== null ? (
            <div className="mt-1.5">
              <ProbabilityBar probability={market.marketProbability} />
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Model consensus</p>
          <p className="font-mono text-lg text-slate-100">{formatPercent(consensus)}</p>
          {consensus !== null ? (
            <div className="mt-1.5">
              <ProbabilityBar probability={consensus} tone="gain" />
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Volume</p>
          <p className="font-mono text-lg text-slate-100">{formatVolume(market.volume)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Forecasts</p>
          <p className="font-mono text-lg text-slate-100">{market.predictions.length}</p>
        </div>
      </div>

      {market.predictions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-800 pt-4">
          {market.predictions.map((prediction) => (
            <span
              key={prediction.id}
              className="pill bg-ink-800/60"
              title={prediction.reasoning ?? undefined}
            >
              <span className="text-slate-400">{prediction.modelName}</span>
              <span className={`font-mono ${predictionTone(market, prediction)}`}>
                {formatPercent(prediction.probability)}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-4 border-t border-ink-800 pt-4 text-sm text-slate-500">
          No model forecasts yet.
        </p>
      )}
    </article>
  );
}
