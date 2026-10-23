import { describe, expect, it } from "vitest";
import {
  deriveCategory,
  isBinaryYesNo,
  parseJsonArray,
  selectCandidates,
  settlementStatus,
  type GammaMarket,
} from "./polymarket.js";

function gammaMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: "1",
    question: "Will it happen?",
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.4", "0.6"]',
    liquidityNum: 50_000,
    volumeNum: 100_000,
    endDate: "2026-10-01T00:00:00Z",
    closed: false,
    active: true,
    ...overrides,
  };
}

describe("parseJsonArray", () => {
  it("parses Polymarket's stringified arrays", () => {
    expect(parseJsonArray('["Yes", "No"]')).toEqual(["Yes", "No"]);
  });

  it("returns an empty array for malformed input", () => {
    expect(parseJsonArray("not json")).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
  });
});

describe("isBinaryYesNo", () => {
  it("accepts only two-way yes/no markets", () => {
    expect(isBinaryYesNo(["Yes", "No"])).toBe(true);
    expect(isBinaryYesNo(["Trump", "Biden"])).toBe(false);
    expect(isBinaryYesNo(["Yes", "No", "Maybe"])).toBe(false);
  });
});

describe("selectCandidates", () => {
  it("keeps liquid, open, genuinely uncertain markets", () => {
    const candidates = selectCandidates([gammaMarket()]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceId: "1",
      probability: 0.4,
      liquidity: 50_000,
      category: "Other",
    });
  });

  it("drops closed, illiquid, multi-outcome and near-certain markets", () => {
    const markets = [
      gammaMarket({ id: "closed", closed: true }),
      gammaMarket({ id: "illiquid", liquidityNum: 100 }),
      gammaMarket({ id: "multi", outcomes: '["A", "B", "C"]' }),
      gammaMarket({ id: "certain", outcomePrices: '["0.99", "0.01"]' }),
    ];
    expect(selectCandidates(markets)).toEqual([]);
  });

  it("builds a Polymarket url from the slug", () => {
    const [candidate] = selectCandidates([gammaMarket({ slug: "will-it-happen" })]);
    expect(candidate.url).toBe("https://polymarket.com/market/will-it-happen");
  });
});

describe("deriveCategory", () => {
  it("maps tag slugs onto arena categories", () => {
    expect(deriveCategory([{ slug: "nba" }, { slug: "sports" }])).toBe("Sports");
    expect(deriveCategory([{ slug: "elections" }])).toBe("Politics");
    expect(deriveCategory([{ slug: "bitcoin" }])).toBe("Crypto");
  });

  it("prefers the more specific category when tags overlap", () => {
    expect(deriveCategory([{ slug: "politics" }, { slug: "bitcoin" }])).toBe("Crypto");
  });

  it("matches on labels as well as slugs", () => {
    expect(deriveCategory([{ label: "Esports" }])).toBe("Sports");
  });

  it("falls back to Other", () => {
    expect(deriveCategory([{ slug: "weather-in-topeka" }])).toBe("Other");
    expect(deriveCategory(undefined)).toBe("Other");
  });
});

describe("settlementStatus", () => {
  it("reports open markets with their live price", () => {
    expect(settlementStatus(gammaMarket())).toEqual({
      state: "open",
      probability: 0.4,
      resolutionStatus: null,
    });
  });

  it("settles from the oracle's final word, not the price", () => {
    expect(
      settlementStatus(
        gammaMarket({
          closed: true,
          umaResolutionStatus: "resolved",
          outcomePrices: '["1", "0"]',
        })
      )
    ).toEqual({
      state: "settled",
      outcome: "YES",
      probability: 1,
      source: "uma",
      resolutionStatus: "resolved",
    });
    expect(
      settlementStatus(
        gammaMarket({
          closed: true,
          umaResolutionStatus: "resolved",
          outcomePrices: '["0", "1"]',
        })
      )
    ).toEqual({
      state: "settled",
      outcome: "NO",
      probability: 0,
      source: "uma",
      resolutionStatus: "resolved",
    });
  });

  it("waits while a closed market's proposal can still be disputed", () => {
    expect(
      settlementStatus(
        gammaMarket({
          closed: true,
          umaResolutionStatus: "proposed",
          outcomePrices: '["1", "0"]',
        })
      )
    ).toEqual({ state: "pending", probability: 1, resolutionStatus: "proposed" });
    expect(
      settlementStatus(
        gammaMarket({
          closed: true,
          umaResolutionStatus: "disputed",
          outcomePrices: '["1", "0"]',
        })
      )
    ).toEqual({ state: "pending", probability: 1, resolutionStatus: "disputed" });
  });

  it("marks a 50/50 payout invalid rather than scoring it", () => {
    expect(
      settlementStatus(
        gammaMarket({
          closed: true,
          umaResolutionStatus: "resolved",
          outcomePrices: '["0.5", "0.5"]',
        })
      )
    ).toEqual({
      state: "invalid",
      probability: 0.5,
      source: "uma",
      resolutionStatus: "resolved",
    });
  });

  it("does not score a 'resolved' market whose prices don't decode", () => {
    expect(
      settlementStatus(
        gammaMarket({
          closed: true,
          umaResolutionStatus: "resolved",
          outcomePrices: '["0.8", "0.2"]',
        })
      )
    ).toEqual({ state: "pending", probability: 0.8, resolutionStatus: "resolved" });
  });

  it("falls back to price inference only when no oracle status exists", () => {
    expect(settlementStatus(gammaMarket({ closed: true, outcomePrices: '["1", "0"]' }))).toEqual({
      state: "settled",
      outcome: "YES",
      probability: 1,
      source: "price_inference",
      resolutionStatus: null,
    });
    expect(
      settlementStatus(gammaMarket({ closed: true, outcomePrices: '["0.5", "0.5"]' }))
    ).toEqual({
      state: "invalid",
      probability: 0.5,
      source: "price_inference",
      resolutionStatus: null,
    });
  });

  it("stays pending while a closed market is still in dispute", () => {
    expect(settlementStatus(gammaMarket({ closed: true, outcomePrices: '["0.7", "0.3"]' }))).toEqual(
      { state: "pending", probability: 0.7, resolutionStatus: null }
    );
  });
});
