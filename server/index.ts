import "dotenv/config";
import express from "express";
import { db, getMarketWithPredictions, listMarketsWithPredictions } from "./db.js";
import { resolveMarkets, runPredictions, syncMarkets } from "./jobs.js";
import { buildLeaderboard } from "../shared/scoring.js";
import { ARENA_MODELS } from "../shared/models.js";
import type { ArenaStats } from "../shared/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MINUTES ?? 30) * 60_000;

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/markets", (req, res) => {
  const status = req.query.status;
  res.json(
    listMarketsWithPredictions({
      status: status === "open" || status === "resolved" ? status : undefined,
      limit: Number(req.query.limit ?? 100),
    })
  );
});

app.get("/api/markets/:id", (req, res) => {
  const market = getMarketWithPredictions(req.params.id);
  if (!market) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.json(market);
});

app.get("/api/leaderboard", (_req, res) => {
  res.json(buildLeaderboard(listMarketsWithPredictions({ limit: 500 })));
});

app.get("/api/stats", (_req, res) => {
  const count = (sql: string): number =>
    (db.prepare(sql).get() as { count: number }).count;

  const stats: ArenaStats = {
    markets: count("SELECT COUNT(*) AS count FROM markets"),
    resolvedMarkets: count("SELECT COUNT(*) AS count FROM markets WHERE status = 'resolved'"),
    predictions: count("SELECT COUNT(*) AS count FROM predictions"),
    scoredPredictions: count("SELECT COUNT(*) AS count FROM predictions WHERE scored_at IS NOT NULL"),
    models: ARENA_MODELS.length,
    lastSyncedAt:
      (db.prepare("SELECT MAX(synced_at) AS synced_at FROM markets").get() as {
        synced_at: string | null;
      }).synced_at ?? null,
  };

  res.json(stats);
});

app.get("/api/models", (_req, res) => {
  res.json(ARENA_MODELS);
});

app.post("/api/cycle", async (req, res) => {
  try {
    const marketLimit = Number(req.body?.marketLimit ?? 6);
    const sync = await syncMarkets(marketLimit * 2);
    const predictions = await runPredictions({ marketLimit });
    const resolution = await resolveMarkets();
    res.json({ sync, predictions, resolution });
  } catch (error) {
    console.error("[cycle] failed:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

async function backgroundCycle(): Promise<void> {
  try {
    console.log("[cycle] starting");
    console.log("[cycle] sync", await syncMarkets(12));
    console.log("[cycle] predictions", await runPredictions({ marketLimit: 6 }));
    console.log("[cycle] resolution", await resolveMarkets());
  } catch (error) {
    console.error("[cycle] failed:", error);
  }
}

app.listen(PORT, () => {
  console.log(`Prediction Arena API listening on http://localhost:${PORT}`);

  if (process.env.ARENA_DISABLE_CRON !== "1") {
    void backgroundCycle();
    setInterval(() => void backgroundCycle(), SYNC_INTERVAL_MS);
  }
});
