import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { z } from "zod";
import {
  db,
  getMarketWithPredictions,
  lastSuccessfulRun,
  listCategories,
  listJobRuns,
  listMarketsWithPredictions,
  listStaleOpenMarkets,
  spendTodayUsd,
} from "./db.js";
import {
  DAILY_SPEND_LIMIT_USD,
  JobLockedError,
  requestShutdown,
  runArenaCycle,
  runningJobs,
} from "./jobs.js";
import { rateLimit } from "./ratelimit.js";
import { buildLeaderboard, buildPairwiseComparisons } from "../shared/scoring.js";
import { ARENA_MODELS } from "../shared/models.js";
import { MARKET_CATEGORIES, type ArenaStats, type MarketCategory } from "../shared/types.js";

function parseCategory(value: unknown): MarketCategory | undefined {
  return (MARKET_CATEGORIES as readonly string[]).includes(String(value))
    ? (value as MarketCategory)
    : undefined;
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) return null;
  return Math.floor(parsed);
}

const PORT = parsePositiveInt(process.env.PORT, 8787, 65535) ?? 8787;
const SYNC_INTERVAL_MS = Math.min(
  Math.max(Number(process.env.SYNC_INTERVAL_MINUTES ?? 30), 1),
  24 * 60
) * 60_000;
const ADMIN_KEY = process.env.ARENA_ADMIN_KEY;

const app = express();
app.use(express.json({ limit: "100kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  next();
});

app.use("/api", rateLimit({ windowMs: 60_000, max: 300 }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/ready", (_req, res) => {
  let dbOk = true;
  try {
    db.prepare("SELECT 1 AS ok").get();
  } catch {
    dbOk = false;
  }

  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    lastSuccessfulRun: {
      sync: lastSuccessfulRun("sync"),
      predict: lastSuccessfulRun("predict"),
      resolve: lastSuccessfulRun("resolve"),
    },
    runningJobs: runningJobs(),
    staleOpenMarkets: listStaleOpenMarkets().length,
    spendTodayUsd,
    dailySpendLimitUsd: DAILY_SPEND_LIMIT_USD,
  });
});

app.get("/api/markets", (req, res) => {
  const status = req.query.status;
  const limit = parsePositiveInt(req.query.limit, 100, 500);
  if (limit === null) {
    res.status(400).json({ error: "limit must be an integer between 1 and 500" });
    return;
  }
  res.json(
    listMarketsWithPredictions({
      status: status === "open" || status === "resolved" ? status : undefined,
      category: parseCategory(req.query.category),
      decidingToday: req.query.decidingToday === "true",
      withSignal: req.query.withSignal === "true",
      limit,
    })
  );
});

app.get("/api/categories", (_req, res) => {
  res.json(listCategories());
});

app.get("/api/markets/:id", (req, res) => {
  const market = getMarketWithPredictions(req.params.id);
  if (!market) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.json(market);
});

app.get("/api/leaderboard", (req, res) => {
  res.json(
    buildLeaderboard(
      listMarketsWithPredictions({ limit: 500, category: parseCategory(req.query.category) })
    )
  );
});

app.get("/api/leaderboard/pairwise", (req, res) => {
  res.json(
    buildPairwiseComparisons(
      listMarketsWithPredictions({ limit: 500, category: parseCategory(req.query.category) })
    )
  );
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

app.get("/api/jobs", (req, res) => {
  const limit = parsePositiveInt(req.query.limit, 50, 200) ?? 50;
  res.json(listJobRuns(limit));
});

const cycleLimiter = rateLimit({ windowMs: 3_600_000, max: 12 });

const cycleBodySchema = z
  .object({
    marketLimit: z.number().int().min(1).max(50).optional(),
    horizonDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!ADMIN_KEY) {
    res.status(503).json({ error: "Cycle endpoint disabled: set ARENA_ADMIN_KEY to enable it" });
    return false;
  }
  if (req.get("x-admin-key") !== ADMIN_KEY) {
    res.status(401).json({ error: "Invalid admin key" });
    return false;
  }
  return true;
}

app.post("/api/cycle", cycleLimiter, async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = cycleBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "marketLimit must be 1-50 and horizonDays 1-365" });
    return;
  }

  try {
    res.json(await runArenaCycle(parsed.data));
  } catch (error) {
    if (error instanceof JobLockedError) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error("[cycle] failed:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// Serve the built UI in production when dist/ exists; `npm run build` produces it.
const DIST = resolve("dist");
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => {
    res.sendFile(resolve(DIST, "index.html"));
  });
}

const server = app.listen(PORT, () => {
  console.log(`Prediction Arena API listening on http://localhost:${PORT}`);

  if (process.env.ARENA_DISABLE_CRON !== "1") {
    // No cycle on boot: a server restart must not spend OpenRouter credits by
    // surprise. Set ARENA_RUN_ON_START=1 to opt back into an immediate run.
    if (process.env.ARENA_RUN_ON_START === "1") {
      void runArenaCycle().catch((error) => console.error("[cycle] failed:", error));
    }
    scheduleNextCycle();
  }
});

let cycleTimer: NodeJS.Timeout | null = null;
let cycleInFlight: Promise<unknown> | null = null;
let shuttingDown = false;

function scheduleNextCycle(): void {
  cycleTimer = setTimeout(() => {
    if (shuttingDown) return;
    cycleInFlight = runArenaCycle()
      .catch((error) => console.error("[cycle] failed:", error))
      .finally(() => {
        cycleInFlight = null;
        if (!shuttingDown) scheduleNextCycle();
      });
  }, SYNC_INTERVAL_MS);
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  requestShutdown();
  console.log(`[shutdown] ${signal} received, draining`);

  if (cycleTimer) clearTimeout(cycleTimer);
  const drain = cycleInFlight ?? Promise.resolve();
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref();

  void drain
    .catch(() => undefined)
    .then(() => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
