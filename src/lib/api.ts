import { useCallback, useEffect, useState } from "react";
import type { ArenaStats, LeaderboardRow, MarketWithPredictions } from "@shared/types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function useJson<T>(path: string): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getJson<T>(path)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload };
}

export function useMarkets(status?: "open" | "resolved"): AsyncState<MarketWithPredictions[]> {
  return useJson<MarketWithPredictions[]>(
    status ? `/api/markets?status=${status}` : "/api/markets"
  );
}

export function useMarket(marketId: string | undefined): AsyncState<MarketWithPredictions> {
  return useJson<MarketWithPredictions>(`/api/markets/${marketId ?? ""}`);
}

export function useLeaderboard(): AsyncState<LeaderboardRow[]> {
  return useJson<LeaderboardRow[]>("/api/leaderboard");
}

export function useStats(): AsyncState<ArenaStats> {
  return useJson<ArenaStats>("/api/stats");
}
