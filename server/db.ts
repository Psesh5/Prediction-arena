import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { tradeSignal } from "../shared/trading.js";
import {
  MARKET_CATEGORIES,
  type Market,
  type MarketCategory,
  type MarketWithPredictions,
  type Prediction,
} from "../shared/types.js";

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
  /** Where the final outcome came from: 'uma' or 'price_inference'. */
  resolution_source: string | null;
  /** Raw umaResolutionStatus last seen on the market, e.g. 'resolved'. */
  resolution_status: string | null;
  synced_at: string;
  created_at: string;
}

export interface JobRunRow {
  id: string;
  job_type: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  markets_checked: number | null;
  forecasts_attempted: number | null;
  forecasts_stored: number | null;
  failures: number | null;
  estimated_cost_usd: number | null;
  error_summary: string | null;
}

export interface PredictionRow {
  id: string;
  market_id: string;
  model_id: string;
  model_name: string;
  probability: number;
  requested_stake: number | null;
  pick: string;
  reasoning: string | null;
  market_probability_at_prediction: number | null;
  is_correct: number | null;
  brier_score: number | null;
  beat_market: number | null;
  scored_at: string | null;
  created_at: string;
}

interface Migration {
  version: number;
  name: string;
  up: (database: Database.Database) => void;
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((entry) => entry.name === column);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    up: (database) => {
      database.exec(`
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
      `);
    },
  },
  {
    version: 2,
    name: "predictions.requested_stake",
    up: (database) => {
      if (!hasColumn(database, "predictions", "requested_stake")) {
        database.exec("ALTER TABLE predictions ADD COLUMN requested_stake REAL");
      }
    },
  },
  {
    version: 3,
    name: "job audit and authoritative resolution",
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS job_runs (
          id TEXT PRIMARY KEY,
          job_type TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          markets_checked INTEGER,
          forecasts_attempted INTEGER,
          forecasts_stored INTEGER,
          failures INTEGER,
          estimated_cost_usd REAL,
          error_summary TEXT
        );

        CREATE TABLE IF NOT EXISTS forecast_attempts (
          id TEXT PRIMARY KEY,
          market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
          model_id TEXT NOT NULL,
          model_returned TEXT,
          provider TEXT NOT NULL DEFAULT 'openrouter',
          prompt_version TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          latency_ms INTEGER,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cost_usd REAL,
          status TEXT NOT NULL,
          error_type TEXT,
          error_message TEXT,
          raw_response TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS job_runs_type_idx ON job_runs (job_type, started_at);
        CREATE INDEX IF NOT EXISTS forecast_attempts_day_idx ON forecast_attempts (requested_at);
        CREATE INDEX IF NOT EXISTS forecast_attempts_market_idx ON forecast_attempts (market_id);
      `);

      for (const column of ["resolution_source", "resolution_status"]) {
        if (!hasColumn(database, "markets", column)) {
          database.exec(`ALTER TABLE markets ADD COLUMN ${column} TEXT`);
        }
      }
    },
  },
];

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`);

const applied = new Set(
  (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
    (row) => row.version
  )
);

for (const migration of MIGRATIONS) {
  if (applied.has(migration.version)) continue;
  const apply = db.transaction(() => {
    migration.up(db);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      migration.version,
      migration.name,
      new Date().toISOString()
    );
  });
  apply();
}

function toCategory(value: string | null): MarketCategory {
  return (MARKET_CATEGORIES as readonly string[]).includes(value ?? "")
    ? (value as MarketCategory)
    : "Other";
}

export function toMarket(row: MarketRow): Market {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    question: row.question,
    description: row.description,
    url: row.url,
    imageUrl: row.image_url,
    category: toCategory(row.category),
    marketProbability: row.market_probability,
    volume: row.volume,
    liquidity: row.liquidity,
    endDate: row.end_date,
    status:
      row.status === "resolved" ? "resolved" : row.status === "invalid" ? "invalid" : "open",
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
    requestedStake: row.requested_stake,
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
  category?: MarketCategory;
  /** Only events whose deadline lands within the next 24 hours. */
  decidingToday?: boolean;
  /** Only events where at least one model disagrees enough with the price to bet. */
  withSignal?: boolean;
  limit?: number;
}

/**
 * Polymarket deadlines are stamped at UTC midnight, so a question decided
 * tonight often carries tomorrow's date. A rolling 24h window is what a trader
 * actually means by "decides today".
 */
function decidesToday(endDate: string | null): boolean {
  if (!endDate) return false;
  const deadline = new Date(endDate).getTime();
  if (Number.isNaN(deadline)) return false;
  return deadline <= Date.now() + 24 * 3_600_000;
}

function hasTradeSignal(market: MarketWithPredictions): boolean {
  return market.predictions.some(
    (prediction) => tradeSignal(prediction.probability, market.marketProbability) !== null
  );
}

export function listMarketsWithPredictions(query: MarketQuery = {}): MarketWithPredictions[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const marketRows = query.status === "resolved"
    ? (db
        .prepare(
          `SELECT * FROM markets WHERE status IN ('resolved', 'invalid')
           ORDER BY COALESCE(resolved_at, end_date) DESC LIMIT ?`
        )
        .all(limit) as MarketRow[])
    : query.status === "open"
      ? (db
          .prepare(
            `SELECT * FROM markets WHERE status = 'open'
             ORDER BY COALESCE(end_date, resolved_at) ASC, volume DESC LIMIT ?`
          )
          .all(limit) as MarketRow[])
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

  let markets: MarketWithPredictions[] = marketRows.map((row) => ({
    ...toMarket(row),
    predictions: (byMarket.get(row.id) ?? []).sort((a, b) =>
      a.modelName.localeCompare(b.modelName)
    ),
  }));

  if (query.category) {
    markets = markets.filter((market) => market.category === query.category);
  }
  if (query.decidingToday) {
    markets = markets.filter((market) => decidesToday(market.endDate));
  }
  if (query.withSignal) {
    markets = markets.filter(hasTradeSignal);
  }

  return markets;
}

export function listCategories(): MarketCategory[] {
  const rows = db.prepare("SELECT DISTINCT category FROM markets").all() as {
    category: string | null;
  }[];

  // Rows stored before categories existed, or with an unknown label, surface as
  // "Other" on the card, so the chip has to exist for them too.
  const present = new Set(rows.map((row) => toCategory(row.category)));
  return MARKET_CATEGORIES.filter((category) => present.has(category));
}

export function getMarketWithPredictions(id: string): MarketWithPredictions | null {
  const row = db.prepare("SELECT * FROM markets WHERE id = ?").get(id) as MarketRow | undefined;
  if (!row) return null;

  const predictions = db
    .prepare("SELECT * FROM predictions WHERE market_id = ? ORDER BY model_name")
    .all(id) as PredictionRow[];

  return { ...toMarket(row), predictions: predictions.map(toPrediction) };
}

export function listJobRuns(limit = 50): JobRunRow[] {
  return db
    .prepare("SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as JobRunRow[];
}

export function lastSuccessfulRun(jobType: string): string | null {
  const row = db
    .prepare(
      "SELECT finished_at FROM job_runs WHERE job_type = ? AND status = 'ok' ORDER BY finished_at DESC LIMIT 1"
    )
    .get(jobType) as { finished_at: string | null } | undefined;
  return row?.finished_at ?? null;
}

/** USD spent on OpenRouter today (UTC), summing recorded forecast attempts. */
export function spendTodayUsd(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM forecast_attempts
       WHERE requested_at >= ?`
    )
    .get(new Date().toISOString().slice(0, 10)) as { total: number };
  return row.total;
}

/** Open markets whose end_date has already passed — stuck pending resolution. */
export function listStaleOpenMarkets(): Market[] {
  const rows = db
    .prepare(
      "SELECT * FROM markets WHERE status = 'open' AND end_date <= ? ORDER BY end_date ASC"
    )
    .all(new Date().toISOString()) as MarketRow[];
  return rows.map(toMarket);
}
