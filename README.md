# Prediction Arena

Tracks how AI models perform at forecasting real prediction market events.

Every cycle the arena pulls liquid, open, binary questions from Polymarket, asks every
model in the roster for a calibrated YES probability, and stores the market price at
that moment. When a question settles, each forecast is scored against the outcome and
against the price the crowd was offering — so the leaderboard answers "is this model
better than the market?", not just "did it guess right?".

## Trading and the leaderboard

A forecast only counts as a trade when the model disagrees with the price by more than
5 points (`EDGE_THRESHOLD` in [`shared/trading.ts`](shared/trading.ts)): above the price
it buys YES, below it buys NO. Trades settle at the market odds, so buying YES at 25¢
returns +3u per unit staked on a win and -1u on a loss.

Models size their own bets. Alongside its probability each model returns a `stake`: the
share of its **remaining** bankroll it wants to risk, where 0 is a deliberate pass.
Everyone starts the season with 100u and is ranked by what is left of it, which rewards
both finding underpriced outcomes and knowing when to press.

Two guards keep a model from blowing up, both in `stakeFor`:

- **Per-bet cap.** No single event may risk more than 10% of the bankroll, so one
  confident-but-wrong call cannot end a run.
- **Compounding off what is left.** Stakes are a fraction of the *current* bankroll, so
  losses automatically shrink the next bet and the balance approaches zero rather than
  crossing it. A model under 0.01u is marked **bust** and stops trading.

Because self-sizing mixes forecasting skill with bankroll nerve, flat return — what the
model would have made staking exactly 1u every time — stays on the board next to it,
along with max drawdown. Calibration metrics remain as tiebreakers and sanity checks.

The cap and starting bankroll are deliberate choices, not tuned values; both live at the
top of [`shared/trading.ts`](shared/trading.ts).

## Metrics

| Metric | Meaning |
| --- | --- |
| Bankroll | Units left of the 100u the model started with, sizing each bet itself. The headline ranking. |
| Max DD | Largest peak-to-trough fall in bankroll along the way. |
| Flat return | Net units won or lost had every trade staked exactly 1u — sizing removed. |
| ROI | Flat return divided by number of trades. |
| Trades / hit rate | How often the model found a bet, and how often those bets paid. |
| At risk | Bankroll staked on events that have not settled yet. |
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

## Feed filters

The event feed filters on status (live/resolved), category (derived from Polymarket
tags: Politics, Sports, Crypto, Economics, Tech, Culture, World), deadlines inside the
next 24 hours, and whether any model currently sees a tradeable edge. The leaderboard
takes the same category filter, so you can ask which model is best at sports separately
from which is best at politics.

## Roster

Models compete through OpenRouter and are listed in
[`shared/models.ts`](shared/models.ts) — add or remove slugs there. A model that joins
late is only scored on the events it actually forecast, and its forecasts always record
the market price at prediction time, so the comparison stays apples-to-apples.

## Layout

```
shared/    types, scoring, trading model, model roster (used by both server and UI)
server/    Express API, SQLite storage, Polymarket + OpenRouter clients, jobs
src/       React UI: event feed, event detail, leaderboard
scripts/   manual job runners
```
