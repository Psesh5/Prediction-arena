# Prediction Arena

Tracks how AI models perform at forecasting real prediction market events.

Every cycle the arena pulls liquid, open, binary questions from Polymarket, asks every
model in the roster for a calibrated YES probability, and stores the market price at
that moment. When a question settles, each forecast is scored against the outcome and
against the price the crowd was offering — so the leaderboard answers "is this model
better than the market?", not just "did it guess right?".

## Metrics

| Metric | Meaning |
| --- | --- |
| Brier score | Mean squared error of the forecast. 0 is perfect, 0.25 is a coin flip. Lower is better. |
| Accuracy | Share of resolved events where the model landed on the right side of 50%. |
| Edge vs market | Market Brier minus model Brier. Positive means the model beat the crowd. |
| Beat market | Share of events where the model's Brier beat the market price's Brier. |
| Avg confidence | How far the model tends to sit from 50/50 — high accuracy with low confidence is hedging. |

## Getting started

```sh
npm install
cp .env.example .env   # add your OPENROUTER_API_KEY
npm run dev            # API on :8787, UI on :5173
```

The dev server runs a sync → forecast → resolve cycle on boot and every
`SYNC_INTERVAL_MINUTES` (default 30). Set `ARENA_DISABLE_CRON=1` to turn that off and
drive it manually instead:

```sh
npm run sync -- 6 14   # sync + forecast 6 markets closing within 14 days, then resolve
npm run predict -- 20  # forecast any market missing forecasts
npm run resolve        # refresh prices and score settled markets
```

Data lives in a local SQLite file (`data/arena.db` by default).

## Roster

Models compete through OpenRouter and are listed in
[`shared/models.ts`](shared/models.ts) — add or remove slugs there. A model that joins
late is only scored on the events it actually forecast, and its forecasts always record
the market price at prediction time, so the comparison stays apples-to-apples.

## Layout

```
shared/    types, scoring, model roster (used by both server and UI)
server/    Express API, SQLite storage, Polymarket + OpenRouter clients, jobs
src/       React UI: event feed, event detail, leaderboard
scripts/   manual job runners
```
