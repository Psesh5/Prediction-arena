# Prediction Arena Finish Plan

## Status

Prediction Arena has the core shape of a working prototype:

- Polymarket market ingestion
- OpenRouter forecasting across the model roster
- SQLite persistence
- Forecast resolution and scoring
- Express API
- React event feed, market detail, and leaderboard
- Unit tests for scoring and API-response parsing

It is not yet ready to operate as a reliable public benchmark. The remaining work is primarily production deployment, job safety, resolution correctness, benchmark methodology, integration testing, and operational visibility.

Estimated remaining effort:

- Private functioning demo: **3–5 focused engineering days**
- Reliable public V1: **10–15 focused engineering days**
- Credible benchmark: **approximately three weeks of engineering, plus enough calendar time for markets to resolve**

## V1 Product Decision

Ship V1 as a **closed-book AI forecasting benchmark** unless every model is later given the same retrieval/news package.

Do not add accounts, social features, payments, or major visual redesigns before the data collection and scoring system is reliable.

## P0 — Launch Blockers

### Production deployment

- [ ] Decide on a long-running Node hosting target.
- [ ] Build the React application during deployment.
- [ ] Serve the built frontend from Express, or configure a separate frontend host with an explicit API base URL.
- [ ] Use persistent storage for SQLite and configure automated backups.
- [ ] Move to Postgres before using serverless or multiple application instances.
- [ ] Add production environment documentation.
- [ ] Add a production smoke test.

### API security and validation

- [ ] Protect `POST /api/cycle` with an admin secret or remove it from the public API.
- [ ] Add rate limiting.
- [ ] Validate and cap `marketLimit`, `horizonDays`, and interval configuration.
- [ ] Reject negative, non-finite, and excessively large values.
- [ ] Add security headers.
- [ ] Avoid automatically spending OpenRouter credits merely because the server starts.

### Job reliability

- [ ] Prevent two forecasting cycles from running simultaneously.
- [ ] Replace unguarded `setInterval` execution with a durable scheduler or a database-backed lock.
- [ ] Add timeouts to Polymarket and OpenRouter requests.
- [ ] Add bounded retries with exponential backoff.
- [ ] Cap per-cycle concurrency.
- [ ] Add a configurable daily OpenRouter spending limit.
- [ ] Continue processing when one market or model request fails.
- [ ] Ensure every eligible new market eventually receives forecasts instead of repeatedly selecting already-completed top markets.
- [ ] Add graceful shutdown behavior.

### Job audit trail

Add a `job_runs` table containing:

- Job type
- Start and completion timestamps
- Status
- Markets checked
- Forecasts attempted and stored
- Failures
- Estimated cost
- Error summary

### Resolution correctness

- [ ] Use Polymarket's authoritative final resolution state instead of inferring resolution solely from a closed market reaching 99% or 1%.
- [ ] Handle disputed, invalid, cancelled, and ambiguous markets explicitly.
- [ ] Do not score a market until resolution is final.
- [ ] Store the resolution source and final resolution metadata.
- [ ] Add tests for disputed and invalid markets.
- [ ] Prevent unresolved closed markets from remaining silently pending forever.

### Database correctness

- [ ] Add versioned database migrations.
- [ ] Add a uniqueness/idempotency strategy for job retries.
- [ ] Update question, description, URL, image, category, and other mutable metadata during market synchronization.
- [ ] Add database backup and restore instructions.
- [ ] Verify database health in the production readiness endpoint.

## P0 — Benchmark Correctness

### Primary ranking

Use paired edge versus the market as the primary metric:

```text
edge = market Brier score at forecast time - model Brier score
```

Positive edge means the model beat the market.

Continue showing raw Brier score, accuracy, beat-market rate, and confidence as supporting metrics.

### Comparable samples

- [ ] Calculate model-versus-market edge only on events with both model and market probabilities.
- [ ] Do not subtract averages calculated over different event sets.
- [ ] Compare models on a shared set of questions where possible.
- [ ] Add pairwise model comparisons calculated only on questions forecast by both models.
- [ ] Do not describe late-arriving models as apples-to-apples unless event-set differences are controlled.
- [ ] Show the number of shared forecasts behind every comparison.

### Sample size and uncertainty

- [ ] Mark rankings as **provisional** below 30 resolved forecasts.
- [ ] Consider requiring 50 resolved forecasts for an official ranking.
- [ ] Display 95% bootstrap confidence intervals.
- [ ] Avoid declaring a winner when intervals overlap materially.
- [ ] Show resolved-event count beside every performance metric.

### Correlated markets

- [ ] Identify questions belonging to the same underlying event.
- [ ] Prevent many related election, price-threshold, or candidate markets from dominating the leaderboard.
- [ ] Implement event-family weighting or clustered uncertainty estimates.
- [ ] Document the market inclusion and exclusion rules.

### Forecast timing

Choose and document one of these approaches:

1. Forecast at standardized horizons such as 30, 7, and 1 day before resolution.
2. Forecast when a market enters the arena, store the exact horizon, and publish horizon-specific leaderboards.

Required work:

- [ ] Store forecast horizon.
- [ ] Store the market probability at the exact forecast timestamp.
- [ ] Display forecast time and horizon in the UI.
- [ ] Separate results by forecast horizon when comparing non-standardized forecasts.

### Forecast reproducibility

Store the following for every attempt:

- Requested model slug
- Model identifier actually returned
- Provider
- Prompt version
- Forecast timestamp
- Raw response
- Parsed probability and reasoning
- Input and output tokens
- Cost
- Latency
- Completion status
- Error type

- [ ] Validate the configured model roster at startup or before a cycle.
- [ ] Version prompts instead of silently changing them.
- [ ] Define deterministic provider-routing settings where possible.
- [ ] Clearly document whether models have browsing or retrieval access.

## P1 — Query and API Fixes

- [ ] Remove the 500-market leaderboard truncation.
- [ ] Query the complete resolved history needed for scoring.
- [ ] Avoid allowing open markets to displace resolved history from leaderboard calculations.
- [ ] Return newest resolved markets first.
- [ ] Add API pagination.
- [ ] Add category, date, model, and status filters.
- [ ] Add consistent API error responses.
- [ ] Add readiness information including last successful sync, prediction cycle, and resolution cycle.
- [ ] Add cache headers where appropriate.

## P1 — Frontend

- [ ] Display the last successful data update.
- [ ] Display delayed or failed collection status.
- [ ] Add automatic polling or refresh.
- [ ] Clear or identify stale results when switching feed filters.
- [ ] Add search, category filtering, and pagination.
- [ ] Show forecast timestamp and market price at prediction time.
- [ ] Do not present the market's final price as though it were the forecast-time benchmark.
- [ ] Add model detail pages.
- [ ] Add performance-over-time charts.
- [ ] Add a calibration chart.
- [ ] Show sample sizes and confidence intervals directly in the leaderboard.
- [ ] Add useful empty, loading, and error states.
- [ ] Verify keyboard navigation, table accessibility, and mobile layouts.

## P1 — Testing and CI

### Existing coverage

The repository currently includes unit tests for:

- Forecast prompt construction and response parsing
- Polymarket payload parsing and candidate filtering
- Settlement-state interpretation
- Brier scoring, confidence, consensus, and leaderboard aggregation

### Required additional coverage

- [ ] Database integration tests using a temporary database.
- [ ] Complete sync → predict → resolve tests using mocked external APIs.
- [ ] Express route tests.
- [ ] Authentication and validation tests for administrative endpoints.
- [ ] Concurrent-cycle and idempotency tests.
- [ ] Timeout, retry, rate-limit, and malformed-provider-response tests.
- [ ] Invalid, disputed, and cancelled market tests.
- [ ] Frontend smoke tests.
- [ ] Production build smoke test.

### GitHub Actions

Add a required workflow that runs:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

- [ ] Require the workflow before merging.
- [ ] Add dependency update automation.
- [ ] Add a secret-scanning check.
- [ ] Add a deployment smoke check after production releases.

## P1 — Monitoring and Operations

- [ ] Add structured logs.
- [ ] Add error monitoring.
- [ ] Alert when sync, forecasting, or resolution has not succeeded within its expected window.
- [ ] Track request counts, provider failures, latency, tokens, and cost.
- [ ] Track unresolved markets that are past their deadline.
- [ ] Track incomplete model panels.
- [ ] Document database recovery.
- [ ] Add a manual runbook for restarting failed jobs without duplicate forecasts.

## Recommended Implementation Order

1. Production build and deployment shape
2. Protect and validate the cycle endpoint
3. Job locking, timeouts, retries, concurrency, and spending limits
4. Authoritative resolution handling
5. Leaderboard query and paired-edge corrections
6. Forecast/provider audit metadata
7. Migrations, backups, and job-run history
8. CI and integration tests
9. Private deployment and data collection
10. Calibration, uncertainty, model detail pages, and public launch

## V1 Definition of Done

Prediction Arena is ready for a private V1 when:

- [ ] The UI and API deploy successfully from a clean environment.
- [ ] Data survives restarts and is backed up.
- [ ] Only authorized callers can initiate paid work.
- [ ] Two cycles cannot overlap.
- [ ] Provider failures do not abort the entire cycle.
- [ ] Final outcomes come from authoritative resolution data.
- [ ] Forecasts retain complete audit metadata.
- [ ] The leaderboard uses paired, comparable observations.
- [ ] Rankings show sample size and provisional status.
- [ ] CI passes typechecking, linting, tests, and production build.
- [ ] Monitoring detects stopped or repeatedly failing jobs.
- [ ] The methodology and limitations are documented publicly.

Prediction Arena is ready for a credible public leaderboard only after it has accumulated a meaningful number of resolved, sufficiently independent forecasts.
