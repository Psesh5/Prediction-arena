import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAKE_FRACTION,
  MAX_STAKE_FRACTION,
  STARTING_BANKROLL,
  isBust,
  stakeFor,
} from "./trading.js";

describe("stakeFor", () => {
  it("takes the share of bankroll the model asked for", () => {
    expect(stakeFor(0.05, STARTING_BANKROLL)).toBeCloseTo(5);
    expect(stakeFor(0.05, 40)).toBeCloseTo(2);
  });

  it("caps a greedy request", () => {
    expect(stakeFor(0.9, 100)).toBeCloseTo(100 * MAX_STAKE_FRACTION);
  });

  it("falls back to the default when the model declines to size", () => {
    expect(stakeFor(null, 100)).toBeCloseTo(100 * DEFAULT_STAKE_FRACTION);
  });

  it("honours a deliberate pass", () => {
    expect(stakeFor(0, 100)).toBe(0);
  });

  it("treats a negative request as a pass", () => {
    expect(stakeFor(-0.5, 100)).toBe(0);
  });

  it("stops trading once the bankroll is gone", () => {
    expect(stakeFor(0.1, 0)).toBe(0);
    expect(stakeFor(0.1, 0.001)).toBe(0);
  });
});

describe("isBust", () => {
  it("is true only once the bankroll is effectively empty", () => {
    expect(isBust(0)).toBe(true);
    expect(isBust(0.001)).toBe(true);
    expect(isBust(1)).toBe(false);
  });
});
