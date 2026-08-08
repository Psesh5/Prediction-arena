import type { Outcome } from "./types.js";

/** Minimum gap between a model's probability and the price to justify a bet. */
export const EDGE_THRESHOLD = 0.05;

/** Prices this extreme have too little room (or too much slippage) to trade. */
const MIN_PRICE = 0.02;
const MAX_PRICE = 0.98;

export interface TradeSignal {
  side: Outcome;
  /** Price paid per share, i.e. the cost of the side being bought. */
  price: number;
  /** How far the model's probability sits from the market price. */
  edge: number;
  /** Profit per unit staked if the bet wins. */
  payoff: number;
  /** Model's probability of the side it is buying. */
  modelProbability: number;
}

/**
 * A trade exists when a model disagrees with the price by more than the
 * threshold: buy YES when the model thinks the market is underpricing the
 * event, buy NO when it thinks the market is overpricing it.
 */
export function tradeSignal(
  probabilityYes: number,
  marketProbability: number | null,
  threshold = EDGE_THRESHOLD
): TradeSignal | null {
  if (marketProbability === null) return null;
  if (marketProbability < MIN_PRICE || marketProbability > MAX_PRICE) return null;

  const edge = probabilityYes - marketProbability;
  if (Math.abs(edge) < threshold) return null;

  const side: Outcome = edge > 0 ? "YES" : "NO";
  const price = side === "YES" ? marketProbability : 1 - marketProbability;

  return {
    side,
    price,
    edge: Math.abs(edge),
    payoff: (1 - price) / price,
    modelProbability: side === "YES" ? probabilityYes : 1 - probabilityYes,
  };
}

/** Profit or loss on one unit staked, settled at the market odds. */
export function tradeReturn(signal: TradeSignal, outcome: Outcome): number {
  return signal.side === outcome ? signal.payoff : -1;
}

/** Every model starts the season with the same bankroll, in units. */
export const STARTING_BANKROLL = 100;

/** No single event may risk more than this share of a model's bankroll. */
export const MAX_STAKE_FRACTION = 0.1;

/** Used when a model declines to size its own bet. */
export const DEFAULT_STAKE_FRACTION = 0.02;

/** A model with less than this left is bust and stops trading. */
const RUIN_THRESHOLD = 0.01;

/**
 * Turns a model's requested share of bankroll into an actual stake. The cap is
 * what keeps a single confident-but-wrong forecast from ending a model's run.
 */
export function stakeFor(requestedFraction: number | null, bankroll: number): number {
  if (bankroll < RUIN_THRESHOLD) return 0;

  const requested = requestedFraction ?? DEFAULT_STAKE_FRACTION;
  const fraction = Math.min(Math.max(requested, 0), MAX_STAKE_FRACTION);
  return bankroll * fraction;
}

export function isBust(bankroll: number): boolean {
  return bankroll < RUIN_THRESHOLD;
}

/**
 * Expected value per unit staked, using the model's own probability. Useful for
 * ranking live opportunities before anything has resolved.
 */
export function expectedValue(signal: TradeSignal): number {
  return signal.modelProbability * signal.payoff - (1 - signal.modelProbability);
}
