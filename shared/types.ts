export type MarketStatus = "open" | "resolved" | "invalid";
export type Outcome = "YES" | "NO";

export const MARKET_CATEGORIES = [
  "Politics",
  "Sports",
  "Crypto",
  "Economics",
  "Tech",
  "Culture",
  "World",
  "Other",
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export interface Market {
  id: string;
  source: string;
  sourceId: string;
  question: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  category: MarketCategory;
  marketProbability: number | null;
  volume: number | null;
  liquidity: number | null;
  endDate: string | null;
  status: MarketStatus;
  resolvedOutcome: Outcome | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface Prediction {
  id: string;
  marketId: string;
  modelId: string;
  modelName: string;
  /** The model's probability that the market resolves YES. */
  probability: number;
  /** Share of its bankroll the model asked to risk, before any cap. */
  requestedStake: number | null;
  pick: Outcome;
  reasoning: string | null;
  /** Market-implied YES probability at the time the forecast was made. */
  marketProbabilityAtPrediction: number | null;
  isCorrect: boolean | null;
  brierScore: number | null;
  beatMarket: boolean | null;
  createdAt: string;
}

export interface MarketWithPredictions extends Market {
  predictions: Prediction[];
}

export interface LeaderboardRow {
  modelId: string;
  modelName: string;
  resolvedCount: number;
  openCount: number;
  accuracy: number;
  brierScore: number;
  marketBrierScore: number;
  beatMarketRate: number;
  /** Market Brier minus model Brier: positive means the model beats the crowd. */
  edge: number;
  averageConfidence: number;
  /** Settled bets placed at market odds, one unit staked per trade. */
  trades: number;
  tradeWins: number;
  tradeWinRate: number;
  /** Net units won or lost across all settled trades. */
  totalReturn: number;
  /** Net return divided by total staked. */
  roi: number;
  /** Units currently staked on events that have not settled. */
  openStake: number;
  /** Bankroll left after settling every trade, starting from STARTING_BANKROLL. */
  bankroll: number;
  /** Largest peak-to-trough fall in bankroll along the way. */
  maxDrawdown: number;
  /** True once the bankroll is spent: the model stops trading. */
  bust: boolean;
  /** True until the model has enough resolved forecasts for a stable ranking. */
  provisional: boolean;
  /** 95% bootstrap confidence interval on `edge`, null below the CI minimum. */
  edgeCi95: [number, number] | null;
}

/** Head-to-head comparison on the events two models both forecast and resolved. */
export interface PairwiseComparison {
  modelA: string;
  modelB: string;
  sharedResolved: number;
  /** Mean (modelA edge) - (modelB edge) across shared events. */
  meanEdgeDiff: number;
  /** Share of shared events where modelA's Brier beat modelB's. */
  winRateA: number;
}

export interface ArenaStats {
  markets: number;
  resolvedMarkets: number;
  predictions: number;
  scoredPredictions: number;
  models: number;
  lastSyncedAt: string | null;
}
