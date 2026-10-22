import { describe, expect, it } from "vitest";
import { expectedValue, tradeReturn, tradeSignal } from "./trading.js";

describe("tradeSignal", () => {
  it("buys YES when the model thinks the event is underpriced", () => {
    const signal = tradeSignal(0.6, 0.4);
    expect(signal).toMatchObject({ side: "YES", price: 0.4, modelProbability: 0.6 });
    expect(signal?.edge).toBeCloseTo(0.2);
    expect(signal?.payoff).toBeCloseTo(1.5);
  });

  it("buys NO when the model thinks the event is overpriced", () => {
    const signal = tradeSignal(0.2, 0.5);
    expect(signal).toMatchObject({ side: "NO", price: 0.5, modelProbability: 0.8 });
    expect(signal?.payoff).toBeCloseTo(1);
  });

  it("passes when the model roughly agrees with the price", () => {
    expect(tradeSignal(0.52, 0.5)).toBeNull();
    expect(tradeSignal(0.45, 0.5)).toBeNull();
  });

  it("passes on missing or extreme prices", () => {
    expect(tradeSignal(0.5, null)).toBeNull();
    expect(tradeSignal(0.5, 0.99)).toBeNull();
    expect(tradeSignal(0.5, 0.01)).toBeNull();
  });

  it("respects a custom threshold", () => {
    expect(tradeSignal(0.53, 0.5, 0.01)).not.toBeNull();
  });
});

describe("tradeReturn", () => {
  it("pays the market odds on a win and loses the stake otherwise", () => {
    const long = tradeSignal(0.6, 0.25);
    expect(long).not.toBeNull();
    expect(tradeReturn(long!, "YES")).toBeCloseTo(3);
    expect(tradeReturn(long!, "NO")).toBe(-1);
  });

  it("settles a NO bet at the complementary price", () => {
    const short = tradeSignal(0.1, 0.8);
    expect(short).not.toBeNull();
    expect(tradeReturn(short!, "NO")).toBeCloseTo(4);
    expect(tradeReturn(short!, "YES")).toBe(-1);
  });
});

describe("expectedValue", () => {
  it("is positive when the model's edge is real", () => {
    const signal = tradeSignal(0.6, 0.4);
    expect(expectedValue(signal!)).toBeCloseTo(0.5);
  });
});
