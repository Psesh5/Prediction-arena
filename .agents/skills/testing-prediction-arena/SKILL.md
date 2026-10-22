---
name: testing-prediction-arena
description: How to run and end-to-end test the Prediction Arena app (Vite+React UI on :5173, Express+SQLite API on :8787), including filters, trade signals and the trading leaderboard.
---

# Testing Prediction Arena

## Running the app
From the repo root:

```sh
ARENA_DISABLE_CRON=1 OPENROUTER_API_KEY=$OPENROUTER_API_KEY npm run dev
```

- `ARENA_DISABLE_CRON=1` is important: without it the server immediately runs a
  sync + prediction cycle against Polymarket and OpenRouter (real spend, and it
  mutates `data/arena.db` mid-test, changing counts under you).
- UI http://localhost:5173, API http://localhost:8787. Vite proxies `/api` to :8787,
  so all frontend data comes from the API — curl the API directly to tell whether a
  wrong list came from the server filter or from React state.
- If a server is already running, `pkill -f "tsx watch server/index.ts"` first.
  Use `setsid nohup ... &` when restarting from a shell tool so it survives.

## Useful API cross-checks
```sh
curl -s "localhost:8787/api/markets?status=open&category=Crypto&withSignal=true" | jq length
curl -s localhost:8787/api/categories
curl -s localhost:8787/api/leaderboard | jq '.[] | {modelName, openStake, totalReturn}'
```
Query params: `status=open|resolved`, `category=<MarketCategory>`, `decidingToday=true`,
`withSignal=true`, `limit`. Category / 24h-window / signal filters are applied in memory
in `server/db.ts`, so they run *after* the SQL `LIMIT`.

## Exercising resolved / populated states
Nothing in the seeded DB is resolved, so the leaderboard table and settled-trade badges
are unreachable by default. Make a copy and point the server at it — never mutate
`data/arena.db`:

```sh
cp data/arena.db /tmp/arena-resolved.db     # copy the .db file itself
sqlite3 /tmp/arena-resolved.db "UPDATE markets SET status='resolved', resolved_outcome='YES', resolved_at='2026-01-01T00:00:00Z' WHERE id='<id>';"
ARENA_DISABLE_CRON=1 ARENA_DB_PATH=/tmp/arena-resolved.db npx tsx server/index.ts
```
Gotcha: the DB runs in WAL mode. Do not use `sqlite3 .backup` / `Connection.backup()`
while the live server holds the WAL — you may get a stale snapshot (e.g. 14 of 24
markets). A plain `cp` of `data/arena.db` after the writer has checkpointed gives the
full dataset; verify with `SELECT COUNT(*) FROM markets` before trusting it.

## Signal math (for asserting badges)
`shared/trading.ts`: a bet exists when |model% − price| > 5pt and price is within
2–98¢. Above price → BUY YES at `price`; below → BUY NO at `1 − price`. Badge text is
`<model> BUY <side> @ <round(price*100)>¢ +<round(edge*100)>pt`, and the feed card shows
the *highest-EV* model, where EV = modelProb*payoff − (1−modelProb), payoff = (1−price)/price.
Note `picks YES/NO` on the detail page uses a 50% threshold and can legitimately disagree
with the trade side (e.g. 48% "picks NO" but BUY YES at a 7¢ price).

## Known gaps to watch for
- `GET /api/categories` only lists categories present in the DB and excludes NULL, so
  events that render with an "Other" category pill may have no filter chip and be
  unreachable by category filtering.

## Devin Secrets Needed
- `OPENROUTER_API_KEY` — only needed if you actually run prediction cycles; not required
  for UI/filter/leaderboard testing when `ARENA_DISABLE_CRON=1`.
