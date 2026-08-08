import { Link, useParams } from "react-router-dom";
import type { MarketWithPredictions } from "@shared/types";
import { brierScore, consensusProbability } from "@shared/scoring";
import { useMarket } from "@/lib/api";
import { formatDate, formatPercent, formatScore, formatVolume, timeUntil } from "@/lib/format";
import ProbabilityBar from "@/components/ProbabilityBar";

function outcomeClass(market: MarketWithPredictions, isCorrect: boolean | null): string {
  if (market.status !== "resolved" || isCorrect === null) return "text-slate-300";
  return isCorrect ? "text-gain" : "text-loss";
}

export default function MarketPage() {
  const { marketId } = useParams();
  const { data: market, loading, error } = useMarket(marketId);

  if (loading) return <p className="text-sm text-slate-500">Loading event…</p>;
  if (error) return <p className="text-sm text-loss">{error}</p>;
  if (!market) return <p className="text-sm text-slate-500">Event not found.</p>;

  const consensus = consensusProbability(market.predictions);
  const isResolved = market.status === "resolved" && market.resolvedOutcome !== null;

  return (
    <div>
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-300">
        ← Back to feed
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold leading-snug text-slate-100">{market.question}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="pill">
            {isResolved ? `Resolved ${market.resolvedOutcome}` : timeUntil(market.endDate)}
          </span>
          <span className="pill">Deadline {formatDate(market.endDate)}</span>
          <span className="pill">Volume {formatVolume(market.volume)}</span>
          {market.url ? (
            <a
              href={market.url}
              target="_blank"
              rel="noreferrer"
              className="pill text-accent-soft hover:border-accent/50"
            >
              View on Polymarket
            </a>
          ) : null}
        </div>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-slate-500">Market price (YES)</p>
          <p className="mt-1 font-mono text-3xl text-slate-100">
            {formatPercent(market.marketProbability)}
          </p>
          {market.marketProbability !== null ? (
            <div className="mt-3">
              <ProbabilityBar probability={market.marketProbability} />
            </div>
          ) : null}
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-slate-500">Model consensus (YES)</p>
          <p className="mt-1 font-mono text-3xl text-slate-100">{formatPercent(consensus)}</p>
          {consensus !== null ? (
            <div className="mt-3">
              <ProbabilityBar probability={consensus} tone="gain" />
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-slate-400">Model forecasts</h2>
        {market.predictions.length === 0 ? (
          <p className="card text-sm text-slate-500">No forecasts collected for this event yet.</p>
        ) : (
          <div className="grid gap-3">
            {market.predictions.map((prediction) => {
              const score =
                isResolved && market.resolvedOutcome
                  ? (prediction.brierScore ??
                    brierScore(prediction.probability, market.resolvedOutcome))
                  : null;

              return (
                <article key={prediction.id} className="card">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-100">{prediction.modelName}</p>
                      <p className="font-mono text-xs text-slate-500">{prediction.modelId}</p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-mono text-2xl ${outcomeClass(market, prediction.isCorrect)}`}
                      >
                        {formatPercent(prediction.probability)}
                      </p>
                      <p className="text-xs text-slate-500">
                        picks {prediction.pick}
                        {score !== null ? ` · Brier ${formatScore(score)}` : ""}
                      </p>
                    </div>
                  </div>
                  {prediction.reasoning ? (
                    <p className="mt-3 border-t border-ink-800 pt-3 text-sm leading-relaxed text-slate-400">
                      {prediction.reasoning}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
