/**
 * Bounded, retrying fetch for third-party calls. A single hung or flaky
 * request must never stall a whole job: every call gets a hard timeout and a
 * small number of retries with exponential backoff and jitter.
 */

export interface ResilientFetchOptions {
  /** Hard per-attempt timeout. Default 15s. */
  timeoutMs?: number;
  /** Extra attempts after the first failure. Default 2 (3 attempts total). */
  retries?: number;
  /** Label used in error messages. */
  label?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const MAX_BACKOFF_MS = 8_000;

function backoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS) + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 4xx responses other than 429 are client errors: retrying cannot help. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, label = "request" } = options;

  let lastError: unknown = new Error(`${label}: no attempts made`);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok || !isRetryableStatus(response.status)) return response;

      lastError = new Error(`${label} failed: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < retries) await sleep(backoffMs(attempt));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
