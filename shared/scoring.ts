import {
  STARTING_BANKROLL,
  isBust,
  stakeFor,
  tradeReturn,
  tradeSignal,
  type TradeSignal,
} from "./trading.js";
import type {
  LeaderboardRow,
  MarketWithPredictions,
  Outcome,
  PairwiseComparison,
  Prediction,
} from "./types.js";

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

/** Below this many resolved forecasts a ranking is labelled provisional. */
export const PROVISIONAL_THRESHOLD = 30;

/** Too few paired observations for a confidence interval to mean anything. */
const CI_MIN_SAMPLE = 10;
const CI_RESAMPLES = 2000;

/** Deterministic PRNG so the bootstrap interval is stable between renders. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap 95% CI on mean per-event edge. Resamples the paired observations
 * with replacement; deterministic because every reader should see the same
 * interval for the same data.
 */
export function edgeConfidenceInterval(edges: number[]): [number, number] | null {
  if (edges.length < CI_MIN_SAMPLE) return null;

  const random = mulberry32(edges.length * 2654435761);
  const means: number[] = [];
  for (let i = 0; i < CI_RESAMPLES; i += 1) {
    let sum = 0;
    for (let j = 0; j < edges.length; j += 1) {
      sum += edges[Math.floor(random() * edges.length)];
    }
    means.push(sum / edges.length);
  }
  means.sort((a, b) => a - b);

  return [means[Math.floor(0.025 * CI_RESAMPLES)], means[Math.ceil(0.975 * CI_RESAMPLES) - 1]];
}

interface ModelAccumulator {
  modelName: string;
  openCount: number;
  briers: number[];
  marketBriers: number[];
  correct: number[];
  beats: number[];
  confidences: number[];
  returns: number[];
  pairedEdges: number[];
  settled: SettledTrade[];
  openRequests: (number | null)[];
}

interface SettledTrade {
  resolvedAt: string;
  signal: TradeSignal;
  outcome: Outcome;
  requestedStake: number | null;
}

interface BankrollResult {
  bankroll: number;
  maxDrawdown: number;
  bust: boolean;
}

/**
 * Replays a model's settled bets in resolution order, sizing each from the
 * bankroll it had at the time. Losses therefore shrink later bets, and the
 * per-bet cap in `stakeFor` is what stops one bad call from ending the run.
 */
function simulateBankroll(trades: SettledTrade[]): BankrollResult {
  const ordered = [...trades].sort((a, b) => a.resolvedAt.localeCompare(b.resolvedAt));

  let bankroll = STARTING_BANKROLL;
  let peak = bankroll;
  let maxDrawdown = 0;

  for (const trade of ordered) {
    const stake = stakeFor(trade.requestedStake, bankroll);
    if (stake === 0) continue;

    bankroll += stake * tradeReturn(trade.signal, trade.outcome);
    peak = Math.max(peak, bankroll);
    maxDrawdown = Math.max(maxDrawdown, peak - bankroll);
  }

  return { bankroll, maxDrawdown, bust: isBust(bankroll) };
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
          returns: [],
          pairedEdges: [],
          settled: [],
          openRequests: [],
        };
        byModel.set(prediction.modelId, entry);
      }

      entry.confidences.push(confidence(prediction.probability));

      // Cancelled/refunded markets settle at 50/50: nobody won or lost, so they
      // count toward neither resolved nor open tallies.
      if (market.status === "invalid") continue;

      if (market.status !== "resolved" || !market.resolvedOutcome) {
        entry.openCount += 1;
        if (tradeSignal(prediction.probability, market.marketProbability)) {
          entry.openRequests.push(prediction.requestedStake);
        }
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
        entry.pairedEdges.push(marketBrier - modelBrier);

        const signal = tradeSignal(prediction.probability, marketProbability);
        if (signal) {
          entry.returns.push(tradeReturn(signal, outcome));
          entry.settled.push({
            resolvedAt: market.resolvedAt ?? market.endDate ?? market.createdAt,
            signal,
            outcome,
            requestedStake: prediction.requestedStake,
          });
        }
      }
    }
  }

  const rows: LeaderboardRow[] = [...byModel.entries()].map(([modelId, entry]) => {
    const brier = mean(entry.briers);
    const marketBrier = mean(entry.marketBriers);
    const totalReturn = entry.returns.reduce((sum, value) => sum + value, 0);
    const wins = entry.returns.filter((value) => value > 0).length;
    const { bankroll, maxDrawdown, bust } = simulateBankroll(entry.settled);

    // Open positions are concurrent, so each is sized off the same bankroll
    // rather than compounding through them.
    const openStake = entry.openRequests.reduce<number>(
      (sum, requested) => sum + stakeFor(requested, bankroll),
      0
    );

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
      trades: entry.returns.length,
      tradeWins: wins,
      tradeWinRate: entry.returns.length === 0 ? 0 : wins / entry.returns.length,
      totalReturn,
      roi: entry.returns.length === 0 ? 0 : totalReturn / entry.returns.length,
      openStake,
      bankroll,
      maxDrawdown,
      bust,
      provisional: entry.briers.length < PROVISIONAL_THRESHOLD,
      edgeCi95: edgeConfidenceInterval(entry.pairedEdges),
    };
  });

  // Ranked by trading return first — the metric the arena is actually about —
  // falling back to calibration for models that never found a bet.
  return rows.sort((a, b) => {
    if (a.resolvedCount === 0 || b.resolvedCount === 0) {
      if (a.resolvedCount !== b.resolvedCount) return b.resolvedCount - a.resolvedCount;
      return b.openCount - a.openCount;
    }
    if (a.bankroll !== b.bankroll) return b.bankroll - a.bankroll;
    if (a.totalReturn !== b.totalReturn) return b.totalReturn - a.totalReturn;
    if (a.brierScore !== b.brierScore) return a.brierScore - b.brierScore;
    return b.resolvedCount - a.resolvedCount;
  });
}

interface PairwiseSample {
  modelId: string;
  modelName: string;
  brier: number;
}

/**
 * Head-to-head model comparisons restricted to events both models forecast and
 * both saw resolved, so a late-joining model is never compared on questions it
 * never answered. Only pairs with at least one shared event are returned.
 */
export function buildPairwiseComparisons(
  markets: MarketWithPredictions[]
): PairwiseComparison[] {
  const byEvent = new Map<string, { marketBrier: number | null; samples: PairwiseSample[] }>();

  for (const market of markets) {
    if (market.status !== "resolved" || !market.resolvedOutcome) continue;
    const outcome = market.resolvedOutcome;

    const samples: PairwiseSample[] = [];
    let marketBrier: number | null = null;
    for (const prediction of market.predictions) {
      samples.push({
        modelId: prediction.modelId,
        modelName: prediction.modelName,
        brier: brierScore(prediction.probability, outcome),
      });
      if (prediction.marketProbabilityAtPrediction !== null) {
        marketBrier = brierScore(prediction.marketProbabilityAtPrediction, outcome);
      }
    }
    byEvent.set(market.id, { marketBrier, samples });
  }

  interface PairAccum {
    modelA: string;
    modelB: string;
    edgeDiffs: number[];
    winsA: number;
    shared: number;
  }
  const pairs = new Map<string, PairAccum>();

  for (const { marketBrier, samples } of byEvent.values()) {
    for (let i = 0; i < samples.length; i += 1) {
      for (let j = i + 1; j < samples.length; j += 1) {
        const [a, b] = samples[i].modelId < samples[j].modelId
          ? [samples[i], samples[j]]
          : [samples[j], samples[i]];

        const key = `${a.modelId}|${b.modelId}`;
        let pair = pairs.get(key);
        if (!pair) {
          pair = { modelA: a.modelId, modelB: b.modelId, edgeDiffs: [], winsA: 0, shared: 0 };
          pairs.set(key, pair);
        }

        pair.shared += 1;
        if (a.brier < b.brier) pair.winsA += 1;
        if (marketBrier !== null) {
          pair.edgeDiffs.push(marketBrier - a.brier - (marketBrier - b.brier));
        }
      }
    }
  }

  return [...pairs.values()].map((pair) => ({
    modelA: pair.modelA,
    modelB: pair.modelB,
    sharedResolved: pair.shared,
    meanEdgeDiff: mean(pair.edgeDiffs),
    winRateA: pair.shared === 0 ? 0 : pair.winsA / pair.shared,
  }));
}
