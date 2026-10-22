import type { MarketCategory } from "../shared/types.js";
import { fetchWithRetry } from "./http.js";

const GAMMA_API = "https://gamma-api.polymarket.com/markets";

export interface GammaTag {
  label?: string;
  slug?: string;
}

export interface GammaMarket {
  id: string;
  question: string;
  description?: string;
  slug?: string;
  image?: string;
  category?: string;
  outcomes?: string;
  outcomePrices?: string;
  volumeNum?: number;
  liquidityNum?: number;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  umaResolutionStatus?: string;
  tags?: GammaTag[];
}

export interface CandidateMarket {
  sourceId: string;
  question: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  category: MarketCategory;
  probability: number | null;
  volume: number | null;
  liquidity: number | null;
  endDate: string | null;
}

export function parseJsonArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function isBinaryYesNo(outcomes: string[]): boolean {
  return (
    outcomes.length === 2 &&
    outcomes[0].trim().toLowerCase() === "yes" &&
    outcomes[1].trim().toLowerCase() === "no"
  );
}

/** Tag slugs mapped onto the arena's coarse categories, most specific first. */
const CATEGORY_BY_TAG: [MarketCategory, string[]][] = [
  ["Crypto", ["crypto", "bitcoin", "ethereum", "solana", "crypto-prices", "memecoins"]],
  ["Sports", ["sports", "nfl", "nba", "mlb", "soccer", "tennis", "epl", "ufc", "f1", "esports", "golf", "nhl"]],
  ["Politics", ["politics", "elections", "us-politics", "trump", "congress", "geopolitics-2"]],
  ["Economics", ["economy", "economics", "fed-rates", "inflation", "business", "finance", "stocks"]],
  ["Tech", ["tech", "ai", "artificial-intelligence", "science", "space"]],
  ["Culture", ["pop-culture", "culture", "movies", "music", "awards", "celebrities", "tv"]],
  ["World", ["world", "geopolitics", "middle-east", "ukraine", "china", "russia", "israel", "iran"]],
];

export function deriveCategory(tags: GammaTag[] | undefined): MarketCategory {
  const slugs = new Set(
    (tags ?? []).flatMap((tag) => [tag.slug, tag.label?.toLowerCase()].filter(Boolean) as string[])
  );

  for (const [category, tagSlugs] of CATEGORY_BY_TAG) {
    if (tagSlugs.some((slug) => slugs.has(slug))) return category;
  }
  return "Other";
}

export function yesPrice(market: GammaMarket): number | null {
  const price = Number(parseJsonArray(market.outcomePrices)[0]);
  return Number.isFinite(price) ? price : null;
}

export interface CandidateFilter {
  minLiquidity?: number;
  /** Exclude near-certain questions: they make for a boring, easy scoreboard. */
  maxProbability?: number;
}

export function toCandidate(market: GammaMarket): CandidateMarket {
  return {
    sourceId: String(market.id),
    question: market.question,
    description: market.description ?? null,
    url: market.slug ? `https://polymarket.com/market/${market.slug}` : null,
    imageUrl: market.image ?? null,
    category: deriveCategory(market.tags),
    probability: yesPrice(market),
    volume: market.volumeNum ?? null,
    liquidity: market.liquidityNum ?? null,
    endDate: market.endDate ?? null,
  };
}

export function selectCandidates(
  markets: GammaMarket[],
  { minLiquidity = 5000, maxProbability = 0.95 }: CandidateFilter = {}
): CandidateMarket[] {
  return markets
    .filter((market) => {
      if (market.closed) return false;
      if (!isBinaryYesNo(parseJsonArray(market.outcomes))) return false;
      if ((market.liquidityNum ?? 0) < minLiquidity) return false;
      const price = yesPrice(market);
      if (price === null) return false;
      return price <= maxProbability && price >= 1 - maxProbability;
    })
    .map(toCandidate);
}

/**
 * Fetches liquid, open, binary markets that resolve soon enough to actually
 * score the models within a reasonable window.
 */
export async function fetchOpenMarkets(limit: number, horizonDays = 45): Promise<CandidateMarket[]> {
  const params = new URLSearchParams({
    closed: "false",
    active: "true",
    archived: "false",
    order: "volume24hr",
    ascending: "false",
    limit: String(Math.max(limit * 6, 60)),
    include_tag: "true",
    end_date_min: new Date().toISOString(),
    end_date_max: new Date(Date.now() + horizonDays * 86_400_000).toISOString(),
  });

  const response = await fetchWithRetry(`${GAMMA_API}?${params.toString()}`, {}, {
    label: "Polymarket markets",
  });
  if (!response.ok) {
    throw new Error(`Polymarket request failed: ${response.status}`);
  }

  const markets = (await response.json()) as GammaMarket[];
  return selectCandidates(markets).slice(0, limit);
}

export async function fetchMarket(sourceId: string): Promise<GammaMarket | null> {
  const response = await fetchWithRetry(`${GAMMA_API}/${sourceId}`, {}, {
    label: `Polymarket market ${sourceId}`,
    retries: 1,
  });
  if (!response.ok) return null;
  return (await response.json()) as GammaMarket;
}

export type SettlementStatus =
  | { state: "open"; probability: number | null; resolutionStatus: string | null }
  | { state: "pending"; probability: number | null; resolutionStatus: string | null }
  | { state: "settled"; outcome: "YES" | "NO"; probability: number; source: ResolutionSource; resolutionStatus: string | null }
  | { state: "invalid"; probability: number | null; source: ResolutionSource; resolutionStatus: string | null };

export type ResolutionSource = "uma" | "price_inference";

const SETTLED_THRESHOLD = 0.99;
const SPLIT_REFUND_PRICE = 0.5;
const SPLIT_REFUND_TOLERANCE = 0.02;

/**
 * UMA resolution statuses that mean the oracle has delivered a final answer.
 * Anything else on a closed market — "proposed", "disputed", null — still
 * waits, because UMA proposals can be disputed and flipped.
 */
const UMA_FINAL_STATUSES = new Set(["resolved", "settled"]);

function decisiveOutcome(prices: number[]): "YES" | "NO" | null {
  if (prices.length < 2) return null;
  const [yes, no] = prices;
  if (yes >= SETTLED_THRESHOLD && no <= 1 - SETTLED_THRESHOLD) return "YES";
  if (no >= SETTLED_THRESHOLD && yes <= 1 - SETTLED_THRESHOLD) return "NO";
  return null;
}

/** A market that paid out 50/50 — Polymarket's way of cancelling a question. */
function isSplitRefund(prices: number[]): boolean {
  if (prices.length < 2) return false;
  return prices.every(
    (price) => Math.abs(price - SPLIT_REFUND_PRICE) <= SPLIT_REFUND_TOLERANCE
  );
}

function numericPrices(market: GammaMarket): number[] {
  return parseJsonArray(market.outcomePrices)
    .map(Number)
    .filter((price) => Number.isFinite(price));
}

/**
 * Interprets a Gamma market payload as open, closed-but-unsettled, settled, or
 * invalidated. The UMA resolution status is authoritative: a market only
 * scores once the oracle reports a final answer, and a 50/50 payout means the
 * question was voided rather than won. Price thresholds are a fallback for the
 * rare payload that carries no UMA status at all.
 */
export function settlementStatus(market: GammaMarket): SettlementStatus {
  const price = yesPrice(market);
  const resolutionStatus = market.umaResolutionStatus ?? null;
  const prices = numericPrices(market);

  if (!market.closed) {
    return { state: "open", probability: price, resolutionStatus };
  }

  if (resolutionStatus !== null && UMA_FINAL_STATUSES.has(resolutionStatus)) {
    if (isSplitRefund(prices)) {
      return { state: "invalid", probability: price, source: "uma", resolutionStatus };
    }
    const outcome = decisiveOutcome(prices);
    if (outcome !== null) {
      return {
        state: "settled",
        outcome,
        probability: price ?? (outcome === "YES" ? 1 : 0),
        source: "uma",
        resolutionStatus,
      };
    }
    // Final per the oracle but the prices don't decode: don't guess.
    return { state: "pending", probability: price, resolutionStatus };
  }

  if (resolutionStatus !== null) {
    // Closed and under an unresolved/disputed UMA claim: keep waiting.
    return { state: "pending", probability: price, resolutionStatus };
  }

  // No UMA status reported — older payloads. Fall back to price inference so
  // long-settled markets still score, but only on decisive prices.
  if (price === null) return { state: "pending", probability: null, resolutionStatus };
  if (isSplitRefund(prices)) {
    return { state: "invalid", probability: price, source: "price_inference", resolutionStatus };
  }
  if (price >= SETTLED_THRESHOLD) {
    return { state: "settled", outcome: "YES", probability: price, source: "price_inference", resolutionStatus };
  }
  if (price <= 1 - SETTLED_THRESHOLD) {
    return { state: "settled", outcome: "NO", probability: price, source: "price_inference", resolutionStatus };
  }
  return { state: "pending", probability: price, resolutionStatus };
}
