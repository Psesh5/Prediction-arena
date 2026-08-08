import { describe, expect, it } from "vitest";
import { buildForecastPrompt, parseForecast } from "./openrouter.js";
import { MAX_STAKE_FRACTION } from "../shared/trading.js";

describe("parseForecast", () => {
  it("parses a bare JSON object", () => {
    expect(
      parseForecast('{"probability": 0.73, "stake": 0.04, "reasoning": "Base rates favor yes."}')
    ).toEqual({
      probability: 0.73,
      stake: 0.04,
      reasoning: "Base rates favor yes.",
    });
  });

  it("tolerates markdown fences and surrounding prose", () => {
    const content = 'Here you go:\n```json\n{"probability": 0.2, "reasoning": "Unlikely."}\n```';
    expect(parseForecast(content).probability).toBe(0.2);
  });

  it("rejects probabilities outside [0, 1]", () => {
    expect(() => parseForecast('{"probability": 73}')).toThrow(/Invalid probability/);
    expect(() => parseForecast('{"probability": "soon"}')).toThrow(/Invalid probability/);
  });

  it("rejects output with no JSON object", () => {
    expect(() => parseForecast("I cannot forecast this.")).toThrow(/No JSON object/);
  });

  it("recovers a forecast that was truncated mid-reasoning", () => {
    const truncated = '{"probability": 0.65, "reasoning": "Traffic has stayed high and the';
    expect(parseForecast(truncated)).toEqual({
      probability: 0.65,
      stake: null,
      reasoning: "Traffic has stayed high and the",
    });
  });

  it("defaults missing reasoning to an empty string", () => {
    expect(parseForecast('{"probability": 0.5}').reasoning).toBe("");
  });

  it("caps an oversized stake and ignores an unusable one", () => {
    expect(parseForecast('{"probability": 0.5, "stake": 0.9}').stake).toBe(MAX_STAKE_FRACTION);
    expect(parseForecast('{"probability": 0.5, "stake": "a lot"}').stake).toBeNull();
    expect(parseForecast('{"probability": 0.5, "stake": -1}').stake).toBeNull();
  });

  it("treats a missing stake as no opinion rather than a pass", () => {
    expect(parseForecast('{"probability": 0.5}').stake).toBeNull();
    expect(parseForecast('{"probability": 0.5, "stake": 0}').stake).toBe(0);
  });
});

describe("buildForecastPrompt", () => {
  it("includes the question, deadline and today's date", () => {
    const prompt = buildForecastPrompt(
      { question: "Will X happen?", description: "Resolves on X.", endDate: "2026-09-01T00:00:00Z" },
      new Date("2026-08-08T00:00:00Z")
    );
    expect(prompt).toContain("Will X happen?");
    expect(prompt).toContain("2026-09-01");
    expect(prompt).toContain("TODAY: 2026-08-08");
    expect(prompt).toContain('"stake"');
  });

  it("truncates very long resolution details", () => {
    const prompt = buildForecastPrompt({
      question: "Q",
      description: "x".repeat(5000),
      endDate: null,
    });
    expect(prompt).toContain("RESOLUTION DEADLINE: unspecified");
    expect(prompt.length).toBeLessThan(2600);
  });
});
