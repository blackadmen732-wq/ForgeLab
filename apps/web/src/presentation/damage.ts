/**
 * A part's condition, read from what the simulation published — never decided here.
 *
 *   normal → stressed → local damage → severe → ruptured / fractured → destroyed
 *
 * Each stage names the published quantity that put the part there, so the Inspector can
 * say why. Presentation uses the stage for how the part looks and sounds; nothing here can
 * raise, delay or prevent a failure.
 */
export type DamageStage = "normal" | "stressed" | "local" | "severe" | "ruptured" | "destroyed";

export const STAGE_ORDER: readonly DamageStage[] = [
  "normal",
  "stressed",
  "local",
  "severe",
  "ruptured",
  "destroyed",
];

export const STAGE_LABELS: Readonly<Record<DamageStage, string>> = {
  normal: "Normal",
  stressed: "Stressed",
  local: "Local damage",
  severe: "Severe damage",
  ruptured: "Ruptured / failed",
  destroyed: "Destroyed",
};

export interface DamageInputs {
  /** Governing structural utilization (1 = at the allowable). */
  readonly utilization: number;
  readonly temperatureK: number;
  /** Published temperature limit, K (0 when the part has none). */
  readonly limitTemperatureK: number;
  /** Pipe pressure boundary or magnet casing: stress ÷ yield (0 when not applicable). */
  readonly hoopUtilization: number;
  /** Pump head left by cavitation (1 when not cavitating). */
  readonly headFraction: number;
  readonly disabled: boolean;
  /** Failure types the simulation has raised on this part this run. */
  readonly failureTypes: readonly string[];
  /** The part has broken up (its destruction event was fractured). */
  readonly fractured: boolean;
}

export interface DamageReading {
  readonly stage: DamageStage;
  /** Why, from the published values. */
  readonly reason: string;
}

const RUPTURE_TYPES = new Set([
  "pipe_rupture",
  "quench",
  "yield_exceeded",
  "buckling",
  "bending_yield",
  "connection_overload",
  "magnetic_overstress",
]);

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function damageStage(i: DamageInputs): DamageReading {
  const failed = new Set(i.failureTypes);
  const hasLimit = i.limitTemperatureK > 0;
  const heat = hasLimit ? i.temperatureK / i.limitTemperatureK : 0;
  if (i.fractured) return { stage: "destroyed", reason: "Broke apart under the failure." };
  for (const type of failed)
    if (RUPTURE_TYPES.has(type))
      return { stage: "ruptured", reason: `Failed: ${type.replace(/_/g, " ")}.` };
  if (failed.has("melted"))
    return { stage: "ruptured", reason: "Melted through: the circuit is open." };
  if (failed.has("over_temperature") && i.disabled)
    return { stage: "ruptured", reason: "Knocked out by over-heating (tripped or seized)." };
  if (hasLimit && heat >= 1.15)
    return {
      stage: "severe",
      reason: `${Math.round(i.temperatureK - i.limitTemperatureK)} K over its temperature limit.`,
    };
  if (i.headFraction < 0.5)
    return { stage: "severe", reason: `Cavitating: ${pct(i.headFraction)} of its head left.` };
  if (failed.size > 0 && !(failed.size === 1 && failed.has("supply_shortfall")))
    return {
      stage: "local",
      reason: `Raised: ${[...failed].map((t) => t.replace(/_/g, " ")).join(", ")}.`,
    };
  if (hasLimit && heat >= 1) return { stage: "local", reason: "Over its temperature limit." };
  if (i.headFraction < 1)
    return { stage: "local", reason: `Cavitating: ${pct(i.headFraction)} of its head left.` };
  if (i.utilization >= 0.7)
    return { stage: "stressed", reason: `At ${pct(i.utilization)} of its structural allowable.` };
  if (i.hoopUtilization >= 0.7)
    return { stage: "stressed", reason: `Wall at ${pct(i.hoopUtilization)} of yield.` };
  if (hasLimit && heat >= 0.85 && i.temperatureK > 300)
    return {
      stage: "stressed",
      reason: `Within ${Math.round(i.limitTemperatureK - i.temperatureK)} K of its temperature limit.`,
    };
  return { stage: "normal", reason: "Within its ratings." };
}

/** How much damage darkens a surface in the Normal view (0..1). */
export function stageDarkening(stage: DamageStage): number {
  switch (stage) {
    case "local":
      return 0.12;
    case "severe":
      return 0.3;
    case "ruptured":
      return 0.45;
    case "destroyed":
      return 0.55;
    default:
      return 0;
  }
}
