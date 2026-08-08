export function formatPercent(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatScore(value: number | null, digits = 3): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function formatSignedScore(value: number, digits = 3): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

export function formatVolume(volume: number | null): string {
  if (!volume) return "—";
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${Math.round(volume)}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function timeUntil(value: string | null): string {
  if (!value) return "no deadline";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return "no deadline";
  if (days < 0) return "past deadline";
  if (days === 0) return "closes today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}
