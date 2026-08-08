interface ProbabilityBarProps {
  probability: number;
  tone?: "neutral" | "gain" | "loss";
}

const toneClass: Record<NonNullable<ProbabilityBarProps["tone"]>, string> = {
  neutral: "bg-accent",
  gain: "bg-gain",
  loss: "bg-loss",
};

export default function ProbabilityBar({ probability, tone = "neutral" }: ProbabilityBarProps) {
  const width = Math.max(0, Math.min(1, probability)) * 100;

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={`h-full rounded-full ${toneClass[tone]}`} style={{ width: `${width}%` }} />
    </div>
  );
}
