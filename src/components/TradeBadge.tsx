import type { TradeSignal } from "@shared/trading";
import { expectedValue } from "@shared/trading";
import { formatPercent } from "@/lib/format";

interface TradeBadgeProps {
  signal: TradeSignal;
  label?: string;
  outcome?: "won" | "lost";
}

export default function TradeBadge({ signal, label, outcome }: TradeBadgeProps) {
  const toneClass =
    outcome === "won"
      ? "border-gain/50 text-gain"
      : outcome === "lost"
        ? "border-loss/50 text-loss"
        : signal.side === "YES"
          ? "border-gain/40 text-gain"
          : "border-loss/40 text-loss";

  return (
    <span
      className={`pill ${toneClass}`}
      title={`Model ${formatPercent(signal.modelProbability)} vs price ${formatPercent(
        signal.price
      )} · pays ${signal.payoff.toFixed(2)}x · EV ${expectedValue(signal).toFixed(2)}`}
    >
      {label ? <span className="text-slate-400">{label}</span> : null}
      <span className="font-mono">
        BUY {signal.side} @ {Math.round(signal.price * 100)}¢
      </span>
      <span className="font-mono text-slate-400">+{Math.round(signal.edge * 100)}pt</span>
    </span>
  );
}
