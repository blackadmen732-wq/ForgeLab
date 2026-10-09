import type { ConfidenceLevel } from "@forgelab/sim-core";

const TEXT: Record<ConfidenceLevel, { label: string; tip: string }> = {
  supported: {
    label: "Supported",
    tip: "Every model used is inside its documented range.",
  },
  approximate: {
    label: "Approximate",
    tip: "Reduced-order models outside their calibrated range, or scaling laws. Trends are meaningful; exact figures are not.",
  },
  experimental: {
    label: "Experimental",
    tip: "Physics outside what ForgeLab models well. Not eligible for leaderboards.",
  },
  unsupported: {
    label: "Unsupported",
    tip: "ForgeLab cannot calculate part of this design yet, and says so rather than invent a number. Not eligible for leaderboards.",
  },
};

export function ConfidenceBadge({
  level,
  compact = false,
}: {
  level: ConfidenceLevel | string;
  compact?: boolean;
}) {
  const known = (level in TEXT ? level : "experimental") as ConfidenceLevel;
  const { label, tip } = TEXT[known];
  return (
    <span className={`badge badge--conf-${known}`} data-tip={tip}>
      <span className="badge__dot" />
      {compact ? label[0] : label}
    </span>
  );
}
