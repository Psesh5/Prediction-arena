import { randomUUID } from "node:crypto";
import { db, spendTodayUsd, type MarketRow, type PredictionRow } from "./db.js";
import { fetchMarket, fetchOpenMarkets, settlementStatus } from "./polymarket.js";
import {
  listAvailableModelIds,
  requestForecast,
  PROMPT_VERSION,
} from "./openrouter.js";
import { ARENA_MODELS } from "../shared/models.js";
import { brierScore, pickFromProbability } from "../shared/scoring.js";

/** Set true by the shutdown handler so long jobs can wind down cleanly. */
export let shutdownRequested = false;
export function requestShutdown(): void {
  shutdownRequested = true;
}

export class JobLockedError extends Error {
  constructor(jobType: string) {
    super(`job '${jobType}' is already running`);
    this.name = "JobLockedError";
  }
}

const activeJobs = new Set<string>();
export function runningJobs(): string[] {
  return [...activeJobs];
}

interface JobStats {
  marketsChecked?: number;
  forecastsAttempted?: number;
  forecastsStored?: number;
  failures?: number;
  estimatedCostUsd?: number;
}

/**
 * Runs one job under an in-process lock and leaves a row in job_runs either
 * way. A second caller while the lock is held gets JobLockedError rather than
 * a silently doubled cycle.
 */
async function trackJob<T>(
  jobType: string,
  fn: (finalize: (stats: JobStats) => void) => Promise<T>
): Promise<T> {
  if (activeJobs.has(jobType)) throw new JobLockedError(jobType);
  activeJobs.add(jobType);

  const runId = randomUUID();
  db.prepare("INSERT INTO job_runs (id, job_type, started_at, status) VALUES (?, ?, ?, 'running')").run(
    runId,
    jobType,
    new Date().toISOString()
  );

  let stats: JobStats = {};
  try {
    const value = await fn((next) => {
      stats = next;
    });
    db.prepare(
      `UPDATE job_runs SET finished_at = ?, status = 'ok', markets_checked = ?,
       forecasts_attempted = ?, forecasts_stored = ?, failures = ?, estimated_cost_usd = ?
       WHERE id = ?`
    ).run(
      new Date().toISOString(),
      stats.marketsChecked ?? null,
      stats.forecastsAttempted ?? null,
      stats.forecastsStored ?? null,
      stats.failures ?? null,
      stats.estimatedCostUsd ?? null,
      runId
    );
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      `UPDATE job_runs SET finished_at = ?, status = 'failed', error_summary = ?,
       markets_checked = ?, forecasts_attempted = ?, forecasts_stored = ?, failures = ?,
       estimated_cost_usd = ? WHERE id = ?`
    ).run(
      new Date().toISOString(),
      message.slice(0, 500),
      stats.marketsChecked ?? null,
      stats.forecastsAttempted ?? null,
      stats.forecastsStored ?? null,
      stats.failures ?? null,
      stats.estimatedCostUsd ?? null,
      runId
    );
    throw error;
  } finally {
    activeJobs.delete(jobType);
  }
}

/** Runs `fn` over `items` with at most `size` in flight at once. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(size, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const FORECAST_CONCURRENCY = Math.min(
  Math.max(Number(process.env.ARENA_FORECAST_CONCURRENCY ?? 4), 1),
  10
);

/** Daily OpenRouter budget in USD. 0 disables paid forecasting entirely. */
export const DAILY_SPEND_LIMIT_USD = Number(process.env.ARENA_DAILY_SPEND_LIMIT_USD ?? 5);

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
}

export function syncMarkets(limit = 12, horizonDays?: number): Promise<SyncResult> {
  return trackJob("sync", async (finalize) => {
    const candidates = await fetchOpenMarkets(
      limit,
      horizonDays ?? Number(process.env.ARENA_HORIZON_DAYS ?? 45)
    );
    const now = new Date().toISOString();

    const insert = db.prepare(`
      INSERT INTO markets (
        id, source, source_id, question, description, url, image_url, category,
        market_probability, volume, liquidity, end_date, status, synced_at, created_at
      ) VALUES (
        @id, 'polymarket', @sourceId, @question, @description, @url, @imageUrl, @category,
        @probability, @volume, @liquidity, @endDate, 'open', @now, @now
      )
      ON CONFLICT (source, source_id) DO UPDATE SET
        question = excluded.question,
        description = excluded.description,
        url = excluded.url,
        image_url = excluded.image_url,
        category = excluded.category,
        market_probability = excluded.market_probability,
        volume = excluded.volume,
        liquidity = excluded.liquidity,
        end_date = excluded.end_date,
        synced_at = excluded.synced_at
    `);

    let inserted = 0;
    const run = db.transaction(() => {
      for (const candidate of candidates) {
        const existing = db
          .prepare("SELECT id FROM markets WHERE source = 'polymarket' AND source_id = ?")
          .get(candidate.sourceId) as { id: string } | undefined;

        insert.run({ ...candidate, id: existing?.id ?? randomUUID(), now });
        if (!existing) inserted += 1;
      }
    });
    run();

    finalize({ marketsChecked: candidates.length });
    return { fetched: candidates.length, inserted, updated: candidates.length - inserted };
  });
}

export interface PredictionResult {
  attempted: number;
  stored: number;
  failures: string[];
  skippedSpendLimit: number;
}

function classifyError(error: unknown): { type: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { type: "timeout", message };
  }
  if (/failed:\s*\d{3}/.test(message) || /HTTP\s+\d{3}/.test(message)) {
    return { type: "http", message };
  }
  if (/Invalid probability|No JSON object|invalid json/i.test(message)) {
    return { type: "parse", message };
  }
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(message)) {
    return { type: "network", message };
  }
  return { type: "unknown", message };
}

const insertAttempt = () =>
  db.prepare(`
    INSERT INTO forecast_attempts (
      id, market_id, model_id, model_returned, provider, prompt_version,
      requested_at, latency_ms, input_tokens, output_tokens, cost_usd,
      status, error_type, error_message, raw_response, created_at
    ) VALUES (
      @id, @marketId, @modelId, @modelReturned, 'openrouter', @promptVersion,
      @requestedAt, @latencyMs, @inputTokens, @outputTokens, @costUsd,
      @status, @errorType, @errorMessage, @rawResponse, @createdAt
    )
  `);

/**
 * Asks every arena model for a forecast on each market it has not seen yet.
 * Markets with the thinnest coverage go first so every eligible question
 * eventually gets a full panel instead of the top-volume few hoarding every
 * cycle. Each attempt — success, failure, or spend-limit skip — leaves a row
 * in forecast_attempts so a forecast is always reproducible.
 */
export function runPredictions(
  options: { marketLimit?: number; marketId?: string } = {}
): Promise<PredictionResult> {
  return trackJob("predict", async (finalize) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }

    const markets = options.marketId
      ? ([db.prepare("SELECT * FROM markets WHERE id = ?").get(options.marketId)].filter(
          Boolean
        ) as MarketRow[])
      : (db
          .prepare(
            `SELECT m.*, (
               SELECT COUNT(*) FROM predictions p WHERE p.market_id = m.id
             ) AS forecast_count
             FROM markets m WHERE m.status = 'open'
             ORDER BY forecast_count ASC, COALESCE(m.volume, 0) DESC LIMIT ?`
          )
          .all(options.marketLimit ?? 6) as MarketRow[]);

    const insert = db.prepare(`
      INSERT INTO predictions (
        id, market_id, model_id, model_name, probability, requested_stake, pick, reasoning,
        market_probability_at_prediction, created_at
      ) VALUES (
        @id, @marketId, @modelId, @modelName, @probability, @requestedStake, @pick, @reasoning,
        @marketProbability, @createdAt
      )
      ON CONFLICT (market_id, model_id) DO NOTHING
    `);

    const writeAttempt = insertAttempt();
    const failures: string[] = [];
    let attempted = 0;
    let stored = 0;
    let skippedSpendLimit = 0;
    let costUsd = 0;

    for (const market of markets) {
      if (shutdownRequested) break;

      const done = new Set(
        (
          db.prepare("SELECT model_id FROM predictions WHERE market_id = ?").all(market.id) as {
            model_id: string;
          }[]
        ).map((row) => row.model_id)
      );

      const pending = ARENA_MODELS.filter((model) => !done.has(model.id));
      if (pending.length === 0) continue;

      const results = await mapPool(pending, FORECAST_CONCURRENCY, async (model) => {
        if (shutdownRequested) return { model, outcome: "skipped" as const };

        if (DAILY_SPEND_LIMIT_USD <= 0 || spendTodayUsd() >= DAILY_SPEND_LIMIT_USD) {
          writeAttempt.run({
            id: randomUUID(),
            marketId: market.id,
            modelId: model.id,
            modelReturned: null,
            promptVersion: PROMPT_VERSION,
            requestedAt: new Date().toISOString(),
            latencyMs: null,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            status: "skipped",
            errorType: "spend_limit",
            errorMessage: `daily spend limit ${DAILY_SPEND_LIMIT_USD} USD reached`,
            rawResponse: null,
            createdAt: new Date().toISOString(),
          });
          return { model, outcome: "spend_limited" as const };
        }

        attempted += 1;
        const requestedAt = new Date().toISOString();
        const started = Date.now();
        try {
          const result = await requestForecast(
            {
              question: market.question,
              description: market.description,
              endDate: market.end_date,
            },
            model.id,
            apiKey
          );
          const latencyMs = Date.now() - started;
          costUsd += result.usage.costUsd ?? 0;
          writeAttempt.run({
            id: randomUUID(),
            marketId: market.id,
            modelId: model.id,
            modelReturned: result.modelReturned,
            promptVersion: PROMPT_VERSION,
            requestedAt,
            latencyMs,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            costUsd: result.usage.costUsd,
            status: "stored",
            errorType: null,
            errorMessage: null,
            rawResponse: result.rawResponse,
            createdAt: new Date().toISOString(),
          });
          return { model, outcome: "ok" as const, forecast: result.forecast };
        } catch (error) {
          const { type, message } = classifyError(error);
          writeAttempt.run({
            id: randomUUID(),
            marketId: market.id,
            modelId: model.id,
            modelReturned: null,
            promptVersion: PROMPT_VERSION,
            requestedAt,
            latencyMs: Date.now() - started,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            status: "failed",
            errorType: type,
            errorMessage: message.slice(0, 500),
            rawResponse: null,
            createdAt: new Date().toISOString(),
          });
          failures.push(message);
          console.error(`[predict] ${model.id}: ${message}`);
          return { model, outcome: "failed" as const };
        }
      });

      const write = db.transaction(() => {
        for (const result of results) {
          if (result.outcome === "spend_limited") {
            skippedSpendLimit += 1;
            continue;
          }
          if (result.outcome !== "ok") continue;
          insert.run({
            id: randomUUID(),
            marketId: market.id,
            modelId: result.model.id,
            modelName: result.model.name,
            probability: result.forecast.probability,
            requestedStake: result.forecast.stake,
            pick: pickFromProbability(result.forecast.probability),
            reasoning: result.forecast.reasoning,
            marketProbability: market.market_probability,
            createdAt: new Date().toISOString(),
          });
          stored += 1;
        }
      });
      write();
    }

    finalize({
      marketsChecked: markets.length,
      forecastsAttempted: attempted,
      forecastsStored: stored,
      failures: failures.length + skippedSpendLimit,
      estimatedCostUsd: costUsd,
    });
    return { attempted, stored, failures, skippedSpendLimit };
  });
}

export interface ResolveResult {
  checked: number;
  resolved: number;
  invalidated: number;
  pending: number;
  scored: number;
}

/**
 * Refreshes live prices and scores predictions on markets that have settled.
 * Only the oracle's final word settles a market: closed-but-disputed questions
 * stay pending, and questions that paid out 50/50 are recorded invalid rather
 * than scored.
 */
export function resolveMarkets(): Promise<ResolveResult> {
  return trackJob("resolve", async (finalize) => {
    const openMarkets = db
      .prepare("SELECT * FROM markets WHERE status = 'open'")
      .all() as MarketRow[];

    let resolved = 0;
    let invalidated = 0;
    let pending = 0;
    let scored = 0;

    for (const market of openMarkets) {
      if (shutdownRequested) break;

      let gammaMarket;
      try {
        gammaMarket = await fetchMarket(market.source_id);
      } catch (error) {
        console.error(
          `[resolve] ${market.source_id}: ${error instanceof Error ? error.message : error}`
        );
        continue;
      }
      if (!gammaMarket) continue;

      const status = settlementStatus(gammaMarket);
      const now = new Date().toISOString();

      if (status.state === "open" || status.state === "pending") {
        if (status.state === "pending") pending += 1;
        db.prepare(
          `UPDATE markets SET market_probability = COALESCE(?, market_probability),
           resolution_status = ?, synced_at = ? WHERE id = ?`
        ).run(status.probability, status.resolutionStatus, now, market.id);
        continue;
      }

      if (status.state === "invalid") {
        db.prepare(
          `UPDATE markets SET status = 'invalid', resolved_at = ?, market_probability = ?,
           resolution_source = ?, resolution_status = ?, synced_at = ? WHERE id = ?`
        ).run(now, status.probability, status.source, status.resolutionStatus, now, market.id);
        invalidated += 1;
        continue;
      }

      const outcome = status.outcome;
      const predictions = db
        .prepare("SELECT * FROM predictions WHERE market_id = ?")
        .all(market.id) as PredictionRow[];

      const write = db.transaction(() => {
        db.prepare(
          `UPDATE markets SET status = 'resolved', resolved_outcome = ?, resolved_at = ?,
           market_probability = ?, resolution_source = ?, resolution_status = ?, synced_at = ?
           WHERE id = ?`
        ).run(
          outcome,
          now,
          status.probability,
          status.source,
          status.resolutionStatus,
          now,
          market.id
        );

        for (const prediction of predictions) {
          const modelBrier = brierScore(prediction.probability, outcome);
          const marketProbability = prediction.market_probability_at_prediction;
          const beatMarket =
            marketProbability === null
              ? null
              : Number(modelBrier < brierScore(marketProbability, outcome));

          db.prepare(
            `UPDATE predictions SET is_correct = ?, brier_score = ?, beat_market = ?, scored_at = ?
             WHERE id = ?`
          ).run(
            Number(pickFromProbability(prediction.probability) === outcome),
            modelBrier,
            beatMarket,
            now,
            prediction.id
          );
        }
      });
      write();

      resolved += 1;
      scored += predictions.length;
    }

    finalize({ marketsChecked: openMarkets.length });
    return { checked: openMarkets.length, resolved, invalidated, pending, scored };
  });
}

/** Warns about roster slugs OpenRouter doesn't have; never aborts the cycle. */
export async function validateRoster(apiKey: string): Promise<string[]> {
  try {
    const available = await listAvailableModelIds(apiKey);
    const missing = ARENA_MODELS.filter((model) => !available.has(model.id)).map(
      (model) => model.id
    );
    if (missing.length > 0) {
      console.warn(`[roster] slugs not available on OpenRouter: ${missing.join(", ")}`);
    }
    return missing;
  } catch (error) {
    console.warn(
      `[roster] validation skipped: ${error instanceof Error ? error.message : error}`
    );
    return [];
  }
}

export interface CycleResult {
  sync: SyncResult;
  predictions: PredictionResult;
  resolution: ResolveResult;
  rosterMissing: string[];
}

/** One full sync → predict → resolve pass under a single 'cycle' lock. */
export async function runArenaCycle(options: {
  marketLimit?: number;
  horizonDays?: number;
} = {}): Promise<CycleResult> {
  const marketLimit = options.marketLimit ?? 6;
  const apiKey = process.env.OPENROUTER_API_KEY;

  const rosterMissing = apiKey ? await validateRoster(apiKey) : [];
  const sync = await syncMarkets(marketLimit * 2, options.horizonDays);
  const predictions = await runPredictions({ marketLimit });
  const resolution = await resolveMarkets();
  return { sync, predictions, resolution, rosterMissing };
}
