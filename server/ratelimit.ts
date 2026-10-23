import type { NextFunction, Request, Response } from "express";

interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** Custom key extractor; defaults to client IP. */
  keyOf?: (req: Request) => string;
}

/**
 * Fixed-window in-memory rate limiter. Enough to keep a public API from being
 * hammered on a single-node deployment; a multi-instance deployment would
 * need a shared store, which the Postgres migration plan already covers.
 */
export function rateLimit({ windowMs, max, keyOf }: RateLimitOptions) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    // Bound memory: sweep dead keys periodically instead of on every request.
    if (now - lastSweep > windowMs) {
      for (const [key, timestamps] of hits) {
        const live = timestamps.filter((t) => now - t < windowMs);
        if (live.length === 0) hits.delete(key);
        else hits.set(key, live);
      }
      lastSweep = now;
    }

    const key = keyOf ? keyOf(req) : (req.ip ?? "unknown");
    const live = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (live.length >= max) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }
    live.push(now);
    hits.set(key, live);
    next();
  };
}
