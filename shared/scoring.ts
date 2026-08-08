import type { LeaderboardRow, MarketWithPredictions, Outcome, Prediction } from "./types.js";

/** Brier score of a single binary forecast. Lower is better; 0 is perfect. */
export function brierScore(probabilityYes: number, outcome: Outcome): number {
  const actual = outcome === "YES" ? 1 : 0;
  return (probabilityYes - actual) ** 2;
}

export function pickFromProbability(probabilityYes: number): Outcome {
  return probabilityYes >= 0.5 ? "YES" : "NO";
}

export function isPredictionCorrect(probabilityYes: number, outcome: Outcome): boolean {
  return pickFromProbability(probabilityYes) === outcome;
}

/** Distance from a coin flip, in [0, 1]. */
export function confidence(probabilityYes: number): number {
  return Math.abs(probabilityYes - 0.5) * 2;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function consensusProbability(predictions: Prediction[]): number | null {
  if (predictions.length === 0) return null;
  return mean(predictions.map((prediction) => prediction.probability));
}

interface ModelAccumulator {
  modelName: string;
  openCount: number;
  briers: number[];
  marketBriers: number[];
  correct: number[];
  beats: number[];
  confidences: number[];
}

/**
 * Aggregates per-model performance over resolved markets. A model "beats the
 * market" on a question when its Brier score is lower than the market price's
 * at the moment the forecast was made.
 */
export function buildLeaderboard(markets: MarketWithPredictions[]): LeaderboardRow[] {
  const byModel = new Map<string, ModelAccumulator>();

  for (const market of markets) {
    for (const prediction of market.predictions) {
      let entry = byModel.get(prediction.modelId);
      if (!entry) {
        entry = {
          modelName: prediction.modelName,
          openCount: 0,
          briers: [],
          marketBriers: [],
          correct: [],
          beats: [],
          confidences: [],
        };
        byModel.set(prediction.modelId, entry);
      }

      entry.confidences.push(confidence(prediction.probability));

      if (market.status !== "resolved" || !market.resolvedOutcome) {
        entry.openCount += 1;
        continue;
      }

      const outcome = market.resolvedOutcome;
      const modelBrier = brierScore(prediction.probability, outcome);
      entry.briers.push(modelBrier);
      entry.correct.push(isPredictionCorrect(prediction.probability, outcome) ? 1 : 0);

      const marketProbability = prediction.marketProbabilityAtPrediction;
      if (marketProbability !== null) {
        const marketBrier = brierScore(marketProbability, outcome);
        entry.marketBriers.push(marketBrier);
        entry.beats.push(modelBrier < marketBrier ? 1 : 0);
      }
    }
  }

  const rows: LeaderboardRow[] = [...byModel.entries()].map(([modelId, entry]) => {
    const brier = mean(entry.briers);
    const marketBrier = mean(entry.marketBriers);
    return {
      modelId,
      modelName: entry.modelName,
      resolvedCount: entry.briers.length,
      openCount: entry.openCount,
      accuracy: mean(entry.correct),
      brierScore: brier,
      marketBrierScore: marketBrier,
      beatMarketRate: mean(entry.beats),
      edge: entry.marketBriers.length === 0 ? 0 : marketBrier - brier,
      averageConfidence: mean(entry.confidences),
    };
  });

  return rows.sort((a, b) => {
    if (a.resolvedCount === 0 || b.resolvedCount === 0) {
      if (a.resolvedCount !== b.resolvedCount) return b.resolvedCount - a.resolvedCount;
      return b.openCount - a.openCount;
    }
    if (a.brierScore !== b.brierScore) return a.brierScore - b.brierScore;
    return b.resolvedCount - a.resolvedCount;
  });
}
