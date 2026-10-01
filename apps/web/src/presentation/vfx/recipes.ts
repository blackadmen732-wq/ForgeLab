import type { DestructionEvent } from "../destruction.js";
import type { MarkKind } from "./marks.js";

/**
 * What each failure family looks like, as a list of effect commands. Pure and tested:
 * given the same destruction event, the same effects. Budgets (how many particles, how
 * many rigid fragments) are applied later by the quality tier.
 *
 * Grounded in what physically happens in each case — a quench vents cold helium that
 * sinks, a coolant boil-off releases steam that rises, an arc throws sparks and burns
 * insulation. There is no fireball recipe: a fusion plant holds grams of fuel.
 */
export type V3 = readonly [number, number, number];

export type ParticleKind = "smoke" | "steam" | "vapor" | "dust" | "fire" | "sparks";

export type EffectCommand =
  | {
      readonly type: "emit";
      readonly system: ParticleKind;
      readonly origin: V3;
      readonly direction: V3;
      /** Cone half-angle, rad. */
      readonly spread: number;
      readonly speed: readonly [number, number];
      /** Particles per second while emitting. */
      readonly rate: number;
      readonly duration: number;
      readonly life: readonly [number, number];
      readonly size: readonly [number, number];
      /** Emission area radius around the origin, m. */
      readonly radius: number;
      readonly delay: number;
    }
  | {
      readonly type: "arc";
      readonly from: V3;
      readonly to: V3;
      readonly duration: number;
      readonly strikes: number;
    }
  | {
      readonly type: "shock";
      readonly origin: V3;
      readonly radius: number;
      readonly duration: number;
    }
  | {
      readonly type: "flash";
      readonly origin: V3;
      readonly radius: number;
      readonly color: string;
      readonly duration: number;
    }
  | {
      readonly type: "debris";
      readonly componentId: string;
      readonly origin: V3;
      readonly direction: V3;
      /** Share of the tier's fragment budget, 0..1. */
      readonly amount: number;
      readonly speed: readonly [number, number];
      /** Typical fragment size, m. */
      readonly pieceM: number;
    }
  | {
      readonly type: "ceiling-dust";
      readonly origin: V3;
      readonly radius: number;
      readonly amount: number;
    }
  | {
      /** A damage mark left on the part's surface for the rest of the run. */
      readonly type: "mark";
      readonly componentId: string;
      readonly kind: MarkKind;
      /** Where on the part: the mark is projected onto the surface facing out from here. */
      readonly origin: V3;
      /** Outward direction from the part at that point. */
      readonly direction: V3;
      readonly sizeM: number;
    }
  | {
      readonly type: "camera";
      readonly origin: V3;
      /** 0..1 shake. */
      readonly trauma: number;
      /** 0..1 one-off jolt. */
      readonly kick: number;
      /** 0..1 exposure flash. */
      readonly flash: number;
    };

export interface RecipeContext {
  /** Ends of the part along its longest axis (arc terminals, jet exits). */
  readonly ends: readonly [V3, V3];
  /** Top centre of the part (vents, relief valves). */
  readonly top: V3;
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const UP: V3 = [0, 1, 0];

function emit(
  system: ParticleKind,
  origin: V3,
  direction: V3,
  o: Partial<
    Omit<Extract<EffectCommand, { type: "emit" }>, "type" | "system" | "origin" | "direction">
  >,
): EffectCommand {
  return {
    type: "emit",
    system,
    origin,
    direction,
    spread: o.spread ?? 0.4,
    speed: o.speed ?? [1, 3],
    rate: o.rate ?? 60,
    duration: o.duration ?? 1,
    life: o.life ?? [1, 2],
    size: o.size ?? [0.3, 2],
    radius: o.radius ?? 0.2,
    delay: o.delay ?? 0,
  };
}

export function recipeFor(event: DestructionEvent, ctx: RecipeContext): EffectCommand[] {
  const s = event.severity;
  const at = event.worldPosition;
  const r = Math.max(0.5, event.radiusM);
  const dir = event.worldDirection;
  const base: V3 = [at[0], 0.2, at[2]];
  switch (event.family) {
    case "electrical": {
      const mid = add(ctx.ends[0], ctx.ends[1]);
      const centre: V3 = [mid[0] / 2, mid[1] / 2, mid[2] / 2];
      const out: EffectCommand[] = [
        {
          type: "arc",
          from: ctx.ends[0],
          to: ctx.ends[1],
          duration: 0.3 + 0.9 * s,
          strikes: 3 + Math.round(5 * s),
        },
        { type: "flash", origin: centre, radius: 1.5 + 2 * s, color: "#cfe6ff", duration: 0.25 },
        emit("sparks", centre, UP, {
          spread: 1.3,
          speed: [3, 12],
          rate: 500,
          duration: 0.25 + 0.5 * s,
          life: [0.5, 1.4],
          size: [0.08, 0.02],
        }),
        // Burning insulation: dark, rising smoke.
        emit("smoke", centre, UP, {
          spread: 0.35,
          speed: [0.5, 1.5],
          rate: 30,
          duration: 5 + 5 * s,
          life: [4, 8],
          size: [0.5, 4],
          radius: 0.4,
          delay: 0.3,
        }),
        { type: "camera", origin: centre, trauma: 0.15 + 0.2 * s, kick: 0.1, flash: 0.35 * s },
        // The arc scorches the conductor where it struck; burning insulation soots above it.
        mark(event, "scorch", centre, dir, 0.6 + 1.2 * s),
        ...(event.combustible ? [mark(event, "soot", ctx.top, UP, 1.2 + 1.5 * s)] : []),
      ];
      if (event.combustible && s > 0.5)
        out.push(
          emit("fire", centre, UP, {
            spread: 0.3,
            speed: [1, 2.5],
            rate: 60,
            duration: 3 + 4 * s,
            life: [0.3, 0.8],
            size: [0.5, 0.1],
            radius: 0.3,
            delay: 0.4,
          }),
        );
      return out;
    }
    case "coolant":
      // Relief-valve release: a jet of steam from the hottest point, rising and spreading.
      return [
        ...(event.failureType === "pipe_rupture"
          ? [mark(event, "tear", ctx.top, dir, Math.max(0.4, event.radiusM * 0.8))]
          : []),
        emit("steam", ctx.top, dir, {
          spread: 0.18,
          speed: [9, 20],
          rate: 260,
          duration: 4 + 5 * s,
          life: [1.2, 2.6],
          size: [0.3, 5],
          radius: 0.15,
        }),
        emit("steam", ctx.top, UP, {
          spread: 0.8,
          speed: [0.5, 2],
          rate: 40,
          duration: 8 + 6 * s,
          life: [4, 8],
          size: [2, 9],
          radius: 2,
          delay: 1,
        }),
        { type: "camera", origin: ctx.top, trauma: 0.12 + 0.15 * s, kick: 0.05, flash: 0 },
      ];
    case "cryogenic":
      // Cold helium venting: dense white vapour that falls and spreads over the floor.
      return [
        mark(event, "frost", ctx.top, UP, r * 0.4),
        emit("vapor", ctx.top, UP, {
          spread: 0.6,
          speed: [1, 4],
          rate: 150,
          duration: 5 + 4 * s,
          life: [3, 6],
          size: [0.4, 5],
          radius: r * 0.3,
        }),
      ];
    case "quench":
      return [
        { type: "flash", origin: at, radius: r * 0.5, color: "#bcd8ff", duration: 0.2 },
        emit("vapor", ctx.top, UP, {
          spread: 0.7,
          speed: [3, 10],
          rate: 380,
          duration: 5 + 4 * s,
          life: [3, 7],
          size: [0.5, 6],
          radius: r * 0.4,
        }),
        { type: "shock", origin: base, radius: 8 + 10 * s, duration: 0.9 },
        { type: "ceiling-dust", origin: at, radius: 6 + 6 * s, amount: 0.3 + 0.4 * s },
        { type: "camera", origin: at, trauma: 0.3 + 0.35 * s, kick: 0.3, flash: 0.15 },
        // Cold helium venting frosts the casing around the vent.
        mark(event, "frost", ctx.top, UP, r * 0.6),
        ...(event.structuralState !== "intact" && event.structuralState !== "damaged"
          ? [debris(event, 0.2 + 0.3 * s, [4, 12], r * 0.08)]
          : []),
      ];
    case "disruption":
      // The plasma's energy reaches the wall in milliseconds: a flash inside the vessel,
      // the structure rings, dust shakes down from the roof. The vessel stays put unless
      // the structural solver says otherwise.
      return [
        { type: "flash", origin: at, radius: r * 0.6, color: "#ffd2f0", duration: 0.35 },
        { type: "shock", origin: base, radius: 10 + 15 * s, duration: 1.1 },
        { type: "ceiling-dust", origin: at, radius: 8 + 8 * s, amount: 0.4 + 0.5 * s },
        emit("dust", base, UP, {
          spread: 1.4,
          speed: [1, 4],
          rate: 400,
          duration: 0.3,
          life: [2, 4],
          size: [0.4, 3],
          radius: r * 0.8,
        }),
        { type: "camera", origin: at, trauma: 0.35 + 0.45 * s, kick: 0.45, flash: 0.5 * s },
        ...(event.structuralState === "severe" || event.structuralState === "fractured"
          ? [debris(event, 0.3 + 0.4 * s, [6, 20], r * 0.05)]
          : []),
      ];
    case "structural":
      return [
        mark(event, "crack", at, dir, r * 0.5),
        debris(event, 0.4 + 0.6 * s, [1, 6 + 8 * s], r * 0.15),
        emit("dust", base, UP, {
          spread: 1.5,
          speed: [1, 5],
          rate: 600,
          duration: 0.4,
          life: [2, 5],
          size: [0.4, 4],
          radius: r,
          delay: 0.6,
        }),
        { type: "ceiling-dust", origin: at, radius: 5 + 5 * s, amount: 0.2 + 0.3 * s },
        { type: "camera", origin: at, trauma: 0.25 + 0.4 * s, kick: 0.35, flash: 0 },
      ];
    case "thermal":
      return event.combustible && event.temperature > 600
        ? [
            mark(event, "soot", ctx.top, UP, 1.5),
            emit("smoke", ctx.top, UP, {
              spread: 0.3,
              speed: [0.4, 1.2],
              rate: 20,
              duration: 8,
              life: [4, 8],
              size: [0.4, 3],
              radius: 0.3,
            }),
          ]
        : [];
    case "plasma":
      return [{ type: "flash", origin: at, radius: r * 0.5, color: "#ffd2f0", duration: 0.2 }];
    case "brownout":
    case "flow":
    case "control":
      // Lighting, alarms and machine states carry these; nothing breaks visibly.
      return [];
  }
}

function mark(
  event: DestructionEvent,
  kind: MarkKind,
  origin: V3,
  direction: V3,
  sizeM: number,
): EffectCommand {
  return {
    type: "mark",
    componentId: event.siteComponentId,
    kind,
    origin,
    direction,
    sizeM: Math.min(4, Math.max(0.25, sizeM)),
  };
}

function debris(
  event: DestructionEvent,
  amount: number,
  speed: readonly [number, number],
  pieceM: number,
): EffectCommand {
  return {
    type: "debris",
    componentId: event.componentId,
    origin: event.worldPosition,
    direction: event.worldDirection,
    amount: Math.min(1, amount),
    speed,
    pieceM: Math.min(1.5, Math.max(0.08, pieceM)),
  };
}
