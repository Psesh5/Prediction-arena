import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Market, MarketWithPredictions, Prediction } from "../shared/types.js";

const DB_PATH = resolve(process.env.ARENA_DB_PATH ?? "data/arena.db");

export interface MarketRow {
  id: string;
  source: string;
  source_id: string;
  question: string;
  description: string | null;
  url: string | null;
  image_url: string | null;
  category: string | null;
  market_probability: number | null;
  volume: number | null;
  liquidity: number | null;
  end_date: string | null;
  status: string;
  resolved_outcome: string | null;
  resolved_at: string | null;
  synced_at: string;
  created_at: string;
}

export interface PredictionRow {
  id: string;
  market_id: string;
  model_id: string;
  model_name: string;
  probability: number;
  pick: string;
  reasoning: string | null;
  market_probability_at_prediction: number | null;
  is_correct: number | null;
  brier_score: number | null;
  beat_market: number | null;
  scored_at: string | null;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  question TEXT NOT NULL,
  description TEXT,
  url TEXT,
  image_url TEXT,
  category TEXT,
  market_probability REAL,
  volume REAL,
  liquidity REAL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_outcome TEXT,
  resolved_at TEXT,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  probability REAL NOT NULL,
  pick TEXT NOT NULL,
  reasoning TEXT,
  market_probability_at_prediction REAL,
  is_correct INTEGER,
  brier_score REAL,
  beat_market INTEGER,
  scored_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (market_id, model_id)
);

CREATE INDEX IF NOT EXISTS predictions_market_idx ON predictions (market_id);
CREATE INDEX IF NOT EXISTS predictions_model_idx ON predictions (model_id);
CREATE INDEX IF NOT EXISTS markets_status_idx ON markets (status, end_date);
`;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA);

export function toMarket(row: MarketRow): Market {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    question: row.question,
    description: row.description,
    url: row.url,
    imageUrl: row.image_url,
    category: row.category,
    marketProbability: row.market_probability,
    volume: row.volume,
    liquidity: row.liquidity,
    endDate: row.end_date,
    status: row.status === "resolved" ? "resolved" : "open",
    resolvedOutcome:
      row.resolved_outcome === "YES" || row.resolved_outcome === "NO"
        ? row.resolved_outcome
        : null,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export function toPrediction(row: PredictionRow): Prediction {
  return {
    id: row.id,
    marketId: row.market_id,
    modelId: row.model_id,
    modelName: row.model_name,
    probability: row.probability,
    pick: row.pick === "YES" ? "YES" : "NO",
    reasoning: row.reasoning,
    marketProbabilityAtPrediction: row.market_probability_at_prediction,
    isCorrect: row.is_correct === null ? null : row.is_correct === 1,
    brierScore: row.brier_score,
    beatMarket: row.beat_market === null ? null : row.beat_market === 1,
    createdAt: row.created_at,
  };
}

export interface MarketQuery {
  status?: "open" | "resolved";
  limit?: number;
}

export function listMarketsWithPredictions(query: MarketQuery = {}): MarketWithPredictions[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const marketRows = query.status
    ? (db
        .prepare(
          `SELECT * FROM markets WHERE status = ?
           ORDER BY COALESCE(resolved_at, end_date) ASC, volume DESC LIMIT ?`
        )
        .all(query.status, limit) as MarketRow[])
    : (db
        .prepare(
          `SELECT * FROM markets
           ORDER BY status ASC, COALESCE(volume, 0) DESC LIMIT ?`
        )
        .all(limit) as MarketRow[]);

  if (marketRows.length === 0) return [];

  const placeholders = marketRows.map(() => "?").join(",");
  const predictionRows = db
    .prepare(`SELECT * FROM predictions WHERE market_id IN (${placeholders})`)
    .all(...marketRows.map((row) => row.id)) as PredictionRow[];

  const byMarket = new Map<string, Prediction[]>();
  for (const row of predictionRows) {
    const list = byMarket.get(row.market_id) ?? [];
    list.push(toPrediction(row));
    byMarket.set(row.market_id, list);
  }

  return marketRows.map((row) => ({
    ...toMarket(row),
    predictions: (byMarket.get(row.id) ?? []).sort((a, b) =>
      a.modelName.localeCompare(b.modelName)
    ),
  }));
}

export function getMarketWithPredictions(id: string): MarketWithPredictions | null {
  const row = db.prepare("SELECT * FROM markets WHERE id = ?").get(id) as MarketRow | undefined;
  if (!row) return null;

  const predictions = db
    .prepare("SELECT * FROM predictions WHERE market_id = ? ORDER BY model_name")
    .all(id) as PredictionRow[];

  return { ...toMarket(row), predictions: predictions.map(toPrediction) };
}
