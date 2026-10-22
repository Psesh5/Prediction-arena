import type { MarketCategory } from "../shared/types.js";

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

  const response = await fetch(`${GAMMA_API}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Polymarket request failed: ${response.status}`);
  }

  const markets = (await response.json()) as GammaMarket[];
  return selectCandidates(markets).slice(0, limit);
}

export async function fetchMarket(sourceId: string): Promise<GammaMarket | null> {
  const response = await fetch(`${GAMMA_API}/${sourceId}`);
  if (!response.ok) return null;
  return (await response.json()) as GammaMarket;
}

export type SettlementStatus =
  | { state: "open"; probability: number | null }
  | { state: "pending"; probability: number | null }
  | { state: "settled"; outcome: "YES" | "NO"; probability: number };

const SETTLED_THRESHOLD = 0.99;

/** Interprets a Gamma market payload as open, closed-but-unsettled, or settled. */
export function settlementStatus(market: GammaMarket): SettlementStatus {
  const price = yesPrice(market);
  if (!market.closed) return { state: "open", probability: price };
  if (price === null) return { state: "pending", probability: null };
  if (price >= SETTLED_THRESHOLD) return { state: "settled", outcome: "YES", probability: price };
  if (price <= 1 - SETTLED_THRESHOLD) return { state: "settled", outcome: "NO", probability: price };
  return { state: "pending", probability: price };
}
