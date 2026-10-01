import type { DestructionEvent } from "../destruction.js";
import type { MarkKind } from "./marks.js";

/**
 * What each failure family looks like, as a timed list of effect commands. Pure and
 * tested: given the same destruction event, the same effects. Budgets (how many
 * particles, fragments and marks) are applied later by the quality tier.
 *
 * Every family unfolds — a first physical break, the primary event, secondary reactions,
 * then an aftermath that lingers — rather than one burst. Grounded in what physically
 * happens in each case: an arc strikes between real terminals and re-strikes before
 * protection clears it, a ruptured pipe blows down as a directional jet that weakens as
 * the loop empties, a quench boils helium (the vent follows the published boil-off) and
 * pops the relief valve, a disruption dumps the plasma's energy on the wall in
 * milliseconds. There is no fireball recipe: a fusion plant holds grams of fuel.
 */
export type V3 = readonly [number, number, number];

export type ParticleKind =
  "smoke" | "steam" | "vapor" | "dust" | "fire" | "sparks" | "spray" | "esmoke";

/** Published quantities an emitter can follow live (see reading.ts). */
export type LiveField = "heliumBoilOffKgS";

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
      /**
       * When set, the rate falls as exp(−age / decay) and the speed as its square root —
       * a blowdown (mass flow ∝ pressure, exit speed ∝ √pressure), a dying fire.
       */
      readonly decay?: number;
    }
  | {
      /**
       * An emitter whose rate follows a published value of a part each frame (rate =
       * value × perUnit, capped), for as long as `duration`: the effect stays coupled
       * to the simulation instead of playing a canned length.
       */
      readonly type: "follow";
      readonly system: ParticleKind;
      readonly componentId: string;
      readonly field: LiveField;
      readonly perUnit: number;
      readonly maxRate: number;
      readonly origin: V3;
      readonly direction: V3;
      readonly spread: number;
      readonly speed: readonly [number, number];
      readonly duration: number;
      readonly life: readonly [number, number];
      readonly size: readonly [number, number];
      readonly radius: number;
    }
  | {
      readonly type: "arc";
      readonly from: V3;
      readonly to: V3;
      readonly duration: number;
      readonly strikes: number;
      readonly delay?: number;
    }
  | {
      /** A brief real light: an arc or a disruption lighting the metal around it. */
      readonly type: "light";
      readonly origin: V3;
      readonly color: string;
      /** Peak intensity (candela-like, scene units). */
      readonly intensity: number;
      /** Reach, m. */
      readonly distance: number;
      readonly duration: number;
      readonly delay?: number;
      /** Flicker frequency, Hz (0 = steady decay). */
      readonly flickerHz?: number;
    }
  | {
      readonly type: "shock";
      readonly origin: V3;
      readonly radius: number;
      readonly duration: number;
      readonly delay?: number;
    }
  | {
      readonly type: "flash";
      readonly origin: V3;
      readonly radius: number;
      readonly color: string;
      readonly duration: number;
      readonly delay?: number;
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
  /** Ends of the part along its longest axis (arc terminals, a pipe's run). */
  readonly ends: readonly [V3, V3];
  /** Top centre of the part (vents, relief valves). */
  readonly top: V3;
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const UP: V3 = [0, 1, 0];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

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
    ...(o.decay !== undefined ? { decay: o.decay } : {}),
  };
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

/** Polyethylene-class insulation burns from about 330–410 °C (library XLPE ignition). */
export const INSULATION_IGNITION_K = 623;

export function recipeFor(event: DestructionEvent, ctx: RecipeContext): EffectCommand[] {
  const s = event.severity;
  const at = event.worldPosition;
  const r = Math.max(0.5, event.radiusM);
  const dir = event.worldDirection;
  const base: V3 = [at[0], 0.2, at[2]];
  switch (event.family) {
    case "electrical": {
      // Overload heats the conductor until its insulation fails: an arc strikes between
      // the terminals, re-strikes, and protection clears it in a fraction of a second.
      const mid = add(ctx.ends[0], ctx.ends[1]);
      const centre: V3 = [mid[0] / 2, mid[1] / 2, mid[2] / 2];
      const out: EffectCommand[] = [
        {
          type: "arc",
          from: ctx.ends[0],
          to: ctx.ends[1],
          duration: 0.18 + 0.4 * s,
          strikes: 2 + Math.round(3 * s),
        },
        { type: "arc", from: ctx.ends[0], to: centre, duration: 0.12, strikes: 2, delay: 0.35 },
        {
          type: "light",
          origin: centre,
          color: "#cfe3ff",
          intensity: 40 + 160 * s,
          distance: 8 + 10 * s,
          duration: 0.5,
          flickerHz: 18,
        },
        { type: "flash", origin: centre, radius: 1 + 1.5 * s, color: "#cfe6ff", duration: 0.2 },
        emit("sparks", centre, dir, {
          spread: 1.2,
          speed: [3, 12],
          rate: 500,
          duration: 0.2 + 0.4 * s,
          life: [0.5, 1.4],
          size: [0.08, 0.02],
        }),
        // The arc's own smoke: thin, blue-grey, local to the fault.
        emit("esmoke", centre, UP, {
          spread: 0.5,
          speed: [0.2, 0.8],
          rate: 25,
          duration: 10,
          life: [2, 5],
          size: [0.2, 1.4],
          radius: 0.25,
          delay: 0.2,
          decay: 4,
        }),
        // Aftermath: a lingering wisp and the odd spark from the damaged conductor.
        emit("esmoke", centre, UP, {
          spread: 0.3,
          speed: [0.1, 0.4],
          rate: 2,
          duration: 60,
          life: [3, 6],
          size: [0.2, 1],
          radius: 0.15,
          delay: 8,
        }),
        emit("sparks", centre, UP, {
          spread: 1,
          speed: [1, 3],
          rate: 1.5,
          duration: 20,
          life: [0.3, 0.7],
          size: [0.05, 0.02],
          delay: 3,
        }),
        { type: "camera", origin: centre, trauma: 0.1 + 0.15 * s, kick: 0.12, flash: 0.35 * s },
        mark(event, "scorch", centre, dir, 0.6 + 1.2 * s),
      ];
      if (event.combustible) {
        out.push(mark(event, "soot", ctx.top, UP, 1.2 + 1.5 * s));
        // The arc is the ignition source; cable insulation is the fuel. Flame grows, then
        // dies down as the insulation is consumed. Its smoke is dark and sooty.
        if (s > 0.5)
          out.push(
            emit("fire", centre, UP, {
              spread: 0.3,
              speed: [1, 2.5],
              rate: 70,
              duration: 14,
              life: [0.3, 0.8],
              size: [0.5, 0.1],
              radius: 0.3,
              delay: 0.6,
              decay: 6,
            }),
            emit("smoke", centre, UP, {
              spread: 0.35,
              speed: [0.5, 1.5],
              rate: 30,
              duration: 20,
              life: [4, 8],
              size: [0.5, 4],
              radius: 0.4,
              delay: 1,
              decay: 9,
            }),
            {
              type: "light",
              origin: centre,
              color: "#ff9a3c",
              intensity: 25,
              distance: 7,
              duration: 12,
              delay: 0.6,
              flickerHz: 7,
            },
          );
      }
      return out;
    }
    case "coolant": {
      if (event.failureType === "pipe_rupture") return pipeRupture(event, ctx);
      // Relief release: a jet of steam from the hottest point, rising and spreading.
      return [
        emit("steam", ctx.top, dir, {
          spread: 0.18,
          speed: [9, 20],
          rate: 260,
          duration: 4 + 5 * s,
          life: [1.2, 2.6],
          size: [0.3, 5],
          radius: 0.15,
          decay: 6,
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
        emit("steam", ctx.top, UP, {
          spread: 0.4,
          speed: [0.2, 0.8],
          rate: 4,
          duration: 45,
          life: [3, 6],
          size: [0.5, 3],
          radius: 0.3,
          delay: 10,
        }),
        { type: "camera", origin: ctx.top, trauma: 0.12 + 0.15 * s, kick: 0.05, flash: 0 },
      ];
    }
    case "cryogenic":
      // Refrigeration short of the heat load: helium boils off and vents. The vent
      // follows the published boil-off; cold fog sinks and spreads, then rises as it warms.
      return [
        mark(event, "frost", ctx.top, UP, r * 0.4),
        follow(event, ctx.top, 40, 220, 30, [0.5, 2.5], [3, 7]),
      ];
    case "quench":
      return [
        // The winding goes normal and boils its helium: the vent follows the boil-off…
        follow(event, ctx.top, 40, 400, 90, [2, 8], [4, 9]),
        mark(event, "frost", ctx.top, UP, r * 0.6),
        // …until the pressure lifts the relief valve: a sharp burst of cold vapour.
        emit("vapor", ctx.top, UP, {
          spread: 0.35,
          speed: [6, 14],
          rate: 500,
          duration: 1.2 + 1.5 * s,
          life: [2, 5],
          size: [0.5, 6],
          radius: r * 0.15,
          delay: 0.4,
          decay: 1.5,
        }),
        { type: "shock", origin: base, radius: 6 + 8 * s, duration: 0.8, delay: 0.4 },
        { type: "ceiling-dust", origin: at, radius: 5 + 5 * s, amount: 0.2 + 0.3 * s },
        { type: "camera", origin: at, trauma: 0.2 + 0.3 * s, kick: 0.25, flash: 0.05 },
        // Aftermath: fog pooled on the floor drifts for a minute.
        emit("vapor", base, UP, {
          spread: 1.4,
          speed: [0.2, 0.8],
          rate: 25,
          duration: 60,
          life: [6, 12],
          size: [2, 8],
          radius: r * 0.8,
          delay: 3,
        }),
        ...(event.structuralState !== "intact" && event.structuralState !== "damaged"
          ? [debris(event, 0.2 + 0.3 * s, [4, 12], r * 0.08)]
          : []),
      ];
    case "disruption":
      // The plasma's energy reaches the wall in milliseconds: a flash inside the vessel,
      // a second when the current quenches, the structure rings, dust shakes down. The
      // vessel stays put unless the structural solver says otherwise.
      return [
        { type: "flash", origin: at, radius: r * 0.6, color: "#ffd2f0", duration: 0.3 },
        {
          type: "light",
          origin: at,
          color: "#ffc2e6",
          intensity: 300 + 900 * s,
          distance: 30 + 30 * s,
          duration: 0.6,
        },
        {
          type: "flash",
          origin: at,
          radius: r * 0.45,
          color: "#e9d8ff",
          duration: 0.2,
          delay: 0.18,
        },
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
        // Impact dust where the falling parts land, then a slow settling haze.
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
        emit("dust", base, UP, {
          spread: 1.2,
          speed: [0.1, 0.5],
          rate: 20,
          duration: 20,
          life: [5, 10],
          size: [1, 5],
          radius: r * 1.2,
          delay: 1.5,
          decay: 8,
        }),
        { type: "ceiling-dust", origin: at, radius: 5 + 5 * s, amount: 0.2 + 0.3 * s },
        { type: "camera", origin: at, trauma: 0.25 + 0.4 * s, kick: 0.35, flash: 0 },
      ];
    case "thermal": {
      if (!event.combustible || event.temperature <= 600) return [];
      const burning = event.temperature >= INSULATION_IGNITION_K;
      return [
        mark(event, "soot", ctx.top, UP, 1.5),
        emit("smoke", ctx.top, UP, {
          spread: 0.3,
          speed: [0.4, 1.2],
          rate: 20,
          duration: 30,
          life: [4, 8],
          size: [0.4, 3],
          radius: 0.3,
          decay: 15,
        }),
        ...(burning
          ? [
              emit("fire", ctx.top, UP, {
                spread: 0.3,
                speed: [0.8, 2],
                rate: 40,
                duration: 15,
                life: [0.3, 0.7],
                size: [0.4, 0.1],
                radius: 0.3,
                decay: 7,
              }),
            ]
          : []),
      ];
    }
    case "plasma":
      return [{ type: "flash", origin: at, radius: r * 0.5, color: "#ffd2f0", duration: 0.2 }];
    case "brownout":
    case "flow":
    case "control":
      // Lighting, alarms, machine states and precursor motion carry these; nothing breaks
      // visibly.
      return [];
  }
}

/**
 * A pipe rupture: where the wall tore, a directional jet perpendicular to the pipe on the
 * side facing out of the plant, weakening as the loop blows down; flashing water throws
 * droplets and a rising cloud. A small break (low severity) is a narrow pinhole jet, a
 * large one a wide blast. The blowdown's duration is presentation (it is not simulated).
 */
function pipeRupture(event: DestructionEvent, ctx: RecipeContext): EffectCommand[] {
  const s = event.severity;
  const axis = norm([
    ctx.ends[1][0] - ctx.ends[0][0],
    ctx.ends[1][1] - ctx.ends[0][1],
    ctx.ends[1][2] - ctx.ends[0][2],
  ]);
  const d = event.worldDirection;
  const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
  const out0 = norm([
    d[0] - along * axis[0],
    d[1] - along * axis[1] + 0.15,
    d[2] - along * axis[2],
  ]);
  const mid: V3 = [
    (ctx.ends[0][0] + ctx.ends[1][0]) / 2,
    (ctx.ends[0][1] + ctx.ends[1][1]) / 2,
    (ctx.ends[0][2] + ctx.ends[1][2]) / 2,
  ];
  const r = Math.max(0.1, ctx.top[1] - mid[1]);
  const hole = add(mid, out0, r);
  const pressureMPa = Math.max(0.1, (event.pressure ?? 1.5e7) / 1e6);
  // Exit speed for the look: rises with the square root of the pressure, capped.
  const v = Math.min(70, 8 + 12 * Math.sqrt(pressureMPa));
  const pinhole = s < 0.4;
  return [
    mark(event, "tear", hole, out0, Math.max(0.3, r * (pinhole ? 0.6 : 1.6))),
    emit("steam", hole, out0, {
      spread: pinhole ? 0.05 : 0.16 + 0.1 * s,
      speed: [v * 0.6, v],
      rate: pinhole ? 120 : 420,
      duration: 6 + 14 * s,
      life: [0.8, 1.8],
      size: [pinhole ? 0.15 : 0.4, pinhole ? 2 : 6],
      radius: pinhole ? 0.03 : r * 0.5,
      decay: 3 + 6 * s,
    }),
    emit("spray", hole, out0, {
      spread: pinhole ? 0.08 : 0.35,
      speed: [v * 0.2, v * 0.5],
      rate: pinhole ? 40 : 260,
      duration: 4 + 6 * s,
      life: [0.6, 1.4],
      size: [0.06, 0.03],
      radius: pinhole ? 0.02 : r * 0.4,
      decay: 2 + 3 * s,
    }),
    // The flashed steam rises and spreads under the roof.
    emit("steam", hole, UP, {
      spread: 0.9,
      speed: [0.5, 2],
      rate: 60 * (0.3 + s),
      duration: 20,
      life: [5, 10],
      size: [3, 12],
      radius: 2,
      delay: 0.8,
      decay: 12,
    }),
    // Aftermath: the torn pipe keeps weeping vapour.
    emit("steam", hole, out0, {
      spread: 0.3,
      speed: [0.5, 2],
      rate: 6,
      duration: 60,
      life: [2, 4],
      size: [0.3, 2],
      radius: 0.1,
      delay: 12,
    }),
    // The pipe recoils against the jet; the camera feels the report.
    { type: "camera", origin: hole, trauma: 0.15 + 0.35 * s, kick: pinhole ? 0.05 : 0.3, flash: 0 },
  ];
}

function follow(
  event: DestructionEvent,
  origin: V3,
  perUnit: number,
  maxRate: number,
  duration: number,
  speed: readonly [number, number],
  life: readonly [number, number],
): EffectCommand {
  return {
    type: "follow",
    system: "vapor",
    componentId: event.componentId,
    field: "heliumBoilOffKgS",
    perUnit,
    maxRate,
    origin,
    direction: UP,
    spread: 0.6,
    speed,
    duration,
    life,
    size: [0.5, 6],
    radius: Math.max(0.3, event.radiusM * 0.25),
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
