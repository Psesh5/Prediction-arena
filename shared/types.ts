export type MarketStatus = "open" | "resolved";
export type Outcome = "YES" | "NO";

export interface Market {
  id: string;
  source: string;
  sourceId: string;
  question: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  category: string | null;
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
}

export interface ArenaStats {
  markets: number;
  resolvedMarkets: number;
  predictions: number;
  scoredPredictions: number;
  models: number;
  lastSyncedAt: string | null;
}
