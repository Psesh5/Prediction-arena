import { MAX_STAKE_FRACTION } from "../shared/trading.js";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

export interface ForecastQuestion {
  question: string;
  description: string | null;
  endDate: string | null;
}

export interface Forecast {
  probability: number;
  /** Share of its bankroll the model wants to risk, or null if it declined. */
  stake: number | null;
  reasoning: string;
}

export function buildForecastPrompt(market: ForecastQuestion, today = new Date()): string {
  const deadline = market.endDate ? market.endDate.slice(0, 10) : "unspecified";
  const details = (market.description ?? "None provided").slice(0, 1500);

  return `Forecast the outcome of this prediction market question.

QUESTION: ${market.question}
RESOLUTION DEADLINE: ${deadline}
TODAY: ${today.toISOString().slice(0, 10)}
RESOLUTION DETAILS: ${details}

Reason from base rates, the evidence you know of, and the time remaining.
Avoid defaulting to 50% unless the question is genuinely a coin flip.

You are also managing a bankroll. If your probability differs enough from the
market price, a bet is placed for you at that price; "stake" is the share of
your remaining bankroll you want to risk on it. Size it by how confident you
are in your own number, not by how much you like the outcome. Anything above
${MAX_STAKE_FRACTION} is capped, and losses shrink the bankroll you are sizing
from, so a run of big bets can leave you with nothing to bet with.

Return ONLY this JSON object, with no markdown fence:
{"probability": <number between 0 and 1 that this resolves YES>, "stake": <number between 0 and ${MAX_STAKE_FRACTION}>, "reasoning": "<2-3 sentences>"}`;
}

function validProbability(value: unknown): number {
  const probability = Number(value);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`Invalid probability: ${String(value)}`);
  }
  return probability;
}

/** A stake we cannot make sense of is treated as "no opinion", not as zero. */
function validStake(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const stake = Number(value);
  if (!Number.isFinite(stake) || stake < 0) return null;
  return Math.min(stake, MAX_STAKE_FRACTION);
}

/**
 * Recovers a forecast from output that was cut off before the closing brace,
 * which happens when a chatty model runs into the token limit.
 */
function parseTruncatedForecast(text: string): Forecast {
  const probabilityMatch = /"probability"\s*:\s*([0-9.]+)/.exec(text);
  if (!probabilityMatch) {
    throw new Error(`No JSON object in model output: ${text.slice(0, 120)}`);
  }

  const stakeMatch = /"stake"\s*:\s*([0-9.]+)/.exec(text);
  const reasoningMatch = /"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
  return {
    probability: validProbability(probabilityMatch[1]),
    stake: stakeMatch ? validStake(stakeMatch[1]) : null,
    reasoning: reasoningMatch ? reasoningMatch[1].replace(/\\"/g, '"').trim() : "",
  };
}

export function parseForecast(content: string): Forecast {
  const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end < start) {
    return parseTruncatedForecast(cleaned);
  }

  let parsed: { probability?: unknown; stake?: unknown; reasoning?: unknown };
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as typeof parsed;
  } catch {
    return parseTruncatedForecast(cleaned);
  }

  return {
    probability: validProbability(parsed.probability),
    stake: validStake(parsed.stake),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "",
  };
}

export async function requestForecast(
  market: ForecastQuestion,
  modelId: string,
  apiKey: string
): Promise<Forecast> {
  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Prediction Arena",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: "system",
          content:
            "You are a superforecaster managing a betting bankroll. You output calibrated probabilities rather than opinions, you size bets by your confidence in your own estimate, and you always reply with valid JSON.",
        },
        { role: "user", content: buildForecastPrompt(market) },
      ],
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    throw new Error(`${modelId} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };

  if (data.error) {
    throw new Error(`${modelId} error: ${data.error.message ?? "unknown"}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${modelId} returned no content`);
  }

  return parseForecast(content);
}
