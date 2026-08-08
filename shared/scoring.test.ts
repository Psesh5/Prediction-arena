import { describe, expect, it } from "vitest";
import { brierScore, buildLeaderboard, confidence, consensusProbability, isPredictionCorrect } from "./scoring.js";
import type { MarketWithPredictions, Outcome, Prediction } from "./types.js";

function prediction(overrides: Partial<Prediction> & { modelId: string }): Prediction {
  return {
    id: `${overrides.modelId}-${Math.random()}`,
    marketId: "market-1",
    modelName: overrides.modelId.toUpperCase(),
    probability: 0.5,
    pick: "YES",
    reasoning: null,
    marketProbabilityAtPrediction: 0.5,
    isCorrect: null,
    brierScore: null,
    beatMarket: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function market(
  id: string,
  resolvedOutcome: Outcome | null,
  predictions: Prediction[]
): MarketWithPredictions {
  return {
    id,
    source: "polymarket",
    sourceId: id,
    question: `Question ${id}`,
    description: null,
    url: null,
    imageUrl: null,
    category: null,
    marketProbability: 0.5,
    volume: 1000,
    liquidity: 1000,
    endDate: "2026-12-31T00:00:00Z",
    status: resolvedOutcome ? "resolved" : "open",
    resolvedOutcome,
    resolvedAt: resolvedOutcome ? "2026-02-01T00:00:00Z" : null,
    createdAt: "2026-01-01T00:00:00Z",
    predictions,
  };
}

describe("brierScore", () => {
  it("is zero for a perfect forecast", () => {
    expect(brierScore(1, "YES")).toBe(0);
    expect(brierScore(0, "NO")).toBe(0);
  });

  it("is one for a maximally wrong forecast", () => {
    expect(brierScore(0, "YES")).toBe(1);
  });

  it("is 0.25 for a coin flip", () => {
    expect(brierScore(0.5, "YES")).toBe(0.25);
    expect(brierScore(0.5, "NO")).toBe(0.25);
  });
});

describe("isPredictionCorrect", () => {
  it("treats 0.5 and above as a YES pick", () => {
    expect(isPredictionCorrect(0.5, "YES")).toBe(true);
    expect(isPredictionCorrect(0.49, "YES")).toBe(false);
    expect(isPredictionCorrect(0.2, "NO")).toBe(true);
  });
});

describe("confidence", () => {
  it("scales distance from a coin flip to [0, 1]", () => {
    expect(confidence(0.5)).toBe(0);
    expect(confidence(1)).toBe(1);
    expect(confidence(0.25)).toBe(0.5);
  });
});

describe("consensusProbability", () => {
  it("averages the model forecasts", () => {
    const predictions = [
      prediction({ modelId: "a", probability: 0.2 }),
      prediction({ modelId: "b", probability: 0.8 }),
    ];
    expect(consensusProbability(predictions)).toBeCloseTo(0.5);
  });

  it("returns null without forecasts", () => {
    expect(consensusProbability([])).toBeNull();
  });
});

describe("buildLeaderboard", () => {
  const markets = [
    market("m1", "YES", [
      prediction({ modelId: "sharp", probability: 0.9, marketProbabilityAtPrediction: 0.6 }),
      prediction({ modelId: "blunt", probability: 0.3, marketProbabilityAtPrediction: 0.6 }),
    ]),
    market("m2", "NO", [
      prediction({ modelId: "sharp", probability: 0.1, marketProbabilityAtPrediction: 0.4 }),
      prediction({ modelId: "blunt", probability: 0.7, marketProbabilityAtPrediction: 0.4 }),
    ]),
    market("m3", null, [
      prediction({ modelId: "sharp", probability: 0.55 }),
      prediction({ modelId: "rookie", probability: 0.55 }),
    ]),
  ];

  const rows = buildLeaderboard(markets);

  it("ranks the better-calibrated model first", () => {
    expect(rows[0].modelId).toBe("sharp");
    expect(rows[0].brierScore).toBeCloseTo(0.01);
    expect(rows[0].accuracy).toBe(1);
  });

  it("credits beating the market price", () => {
    const sharp = rows.find((row) => row.modelId === "sharp");
    const blunt = rows.find((row) => row.modelId === "blunt");
    expect(sharp?.beatMarketRate).toBe(1);
    expect(sharp?.edge).toBeGreaterThan(0);
    expect(blunt?.beatMarketRate).toBe(0);
    expect(blunt?.edge).toBeLessThan(0);
  });

  it("counts open forecasts separately and sorts unscored models last", () => {
    expect(rows.find((row) => row.modelId === "sharp")?.openCount).toBe(1);
    expect(rows.at(-1)?.modelId).toBe("rookie");
    expect(rows.at(-1)?.resolvedCount).toBe(0);
  });

  it("ignores market comparison when no price was recorded", () => {
    const noPrice = buildLeaderboard([
      market("m4", "YES", [
        prediction({ modelId: "solo", probability: 0.8, marketProbabilityAtPrediction: null }),
      ]),
    ]);
    expect(noPrice[0].edge).toBe(0);
    expect(noPrice[0].beatMarketRate).toBe(0);
  });
});
