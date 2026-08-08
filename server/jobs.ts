import { randomUUID } from "node:crypto";
import { db, type MarketRow, type PredictionRow } from "./db.js";
import { fetchMarket, fetchOpenMarkets, settlementStatus } from "./polymarket.js";
import { requestForecast } from "./openrouter.js";
import { ARENA_MODELS } from "../shared/models.js";
import { brierScore, pickFromProbability } from "../shared/scoring.js";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
}

export async function syncMarkets(limit = 12, horizonDays?: number): Promise<SyncResult> {
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

  return { fetched: candidates.length, inserted, updated: candidates.length - inserted };
}

export interface PredictionResult {
  attempted: number;
  stored: number;
  failures: string[];
}

/** Asks every arena model for a forecast on each market it has not seen yet. */
export async function runPredictions(
  options: { marketLimit?: number; marketId?: string } = {}
): Promise<PredictionResult> {
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
          `SELECT * FROM markets WHERE status = 'open'
           ORDER BY COALESCE(volume, 0) DESC LIMIT ?`
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

  const failures: string[] = [];
  let attempted = 0;
  let stored = 0;

  for (const market of markets) {
    const done = new Set(
      (
        db.prepare("SELECT model_id FROM predictions WHERE market_id = ?").all(market.id) as {
          model_id: string;
        }[]
      ).map((row) => row.model_id)
    );

    const pending = ARENA_MODELS.filter((model) => !done.has(model.id));
    if (pending.length === 0) continue;

    attempted += pending.length;

    const results = await Promise.all(
      pending.map(async (model) => {
        try {
          const forecast = await requestForecast(
            {
              question: market.question,
              description: market.description,
              endDate: market.end_date,
            },
            model.id,
            apiKey
          );
          return { model, forecast };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          failures.push(message);
          console.error(`[predict] ${model.id}: ${message}`);
          return null;
        }
      })
    );

    const write = db.transaction(() => {
      for (const result of results) {
        if (!result) continue;
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

  return { attempted, stored, failures };
}

export interface ResolveResult {
  checked: number;
  resolved: number;
  scored: number;
}

/** Refreshes live prices and scores predictions on markets that have settled. */
export async function resolveMarkets(): Promise<ResolveResult> {
  const openMarkets = db
    .prepare("SELECT * FROM markets WHERE status = 'open'")
    .all() as MarketRow[];

  let resolved = 0;
  let scored = 0;

  for (const market of openMarkets) {
    const gammaMarket = await fetchMarket(market.source_id);
    if (!gammaMarket) continue;

    const status = settlementStatus(gammaMarket);
    const now = new Date().toISOString();

    if (status.state !== "settled") {
      if (status.probability !== null) {
        db.prepare("UPDATE markets SET market_probability = ?, synced_at = ? WHERE id = ?").run(
          status.probability,
          now,
          market.id
        );
      }
      continue;
    }

    const outcome = status.outcome;
    const predictions = db
      .prepare("SELECT * FROM predictions WHERE market_id = ?")
      .all(market.id) as PredictionRow[];

    const write = db.transaction(() => {
      db.prepare(
        `UPDATE markets SET status = 'resolved', resolved_outcome = ?, resolved_at = ?,
         market_probability = ?, synced_at = ? WHERE id = ?`
      ).run(outcome, now, status.probability, now, market.id);

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

  return { checked: openMarkets.length, resolved, scored };
}
