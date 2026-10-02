import { plantSystemOf } from "@forgelab/reactor-components";
import { currentTransform, worldAabb, type SimulationComponent } from "@forgelab/sim-core";
import { Plane, Vector3 } from "three";

/**
 * Inspection views for large machines: peel layers off, pull the machine apart, or cut
 * the whole plant with one section plane. All presentation: none of it changes the design
 * or what the simulation computes.
 */

/* ------------------------------------------------------------------------------------ *
 * Layer peeling
 * ------------------------------------------------------------------------------------ */

/** Peel levels, outermost first, as a cutaway drawing of a fusion machine opens up. */
export const PEEL_LEVELS = [
  "Full machine",
  "Services hidden",
  "Cryostat hidden",
  "Magnets hidden",
  "Blanket hidden",
  "Vessel cut open",
] as const;
export const MAX_PEEL = PEEL_LEVELS.length - 1;
/** From this level on the remaining parts are cut open towards the camera. */
export const PEEL_CUT_LEVEL = 5;

/** The cryostat is the outermost shell of the machine itself. */
const isCryostat = (c: SimulationComponent) => c.type === "cryostat";

/** Parts hidden at a peel level. */
export function peeledIds(
  components: readonly SimulationComponent[],
  level: number,
): ReadonlySet<string> {
  const out = new Set<string>();
  if (level <= 0) return out;
  for (const c of components) {
    const system = plantSystemOf(c);
    const machine = system === "reactor" || system === "magnets" || isCryostat(c);
    if (!machine) out.add(c.id);
    else if (level >= 2 && isCryostat(c)) out.add(c.id);
    else if (level >= 3 && system === "magnets") out.add(c.id);
    else if (level >= 4 && c.role === "blanket") out.add(c.id);
  }
  return out;
}

/* ------------------------------------------------------------------------------------ *
 * Exploded view
 * ------------------------------------------------------------------------------------ */

/** How far apart nested shells lift at full explode, per layer, m. */
const SHELL_LIFT_M = 7;

/** Outward rank of a shell that shares the machine's centre: vessel 0 … cryostat 3. */
function shellRank(c: SimulationComponent): number {
  if (isCryostat(c)) return 3;
  if (c.role === "magnet-coil") return 2;
  if (c.role === "blanket") return 1;
  return 0;
}

const centreOf = (c: SimulationComponent) => {
  const b = worldAabb(c.geometry, currentTransform(c));
  return new Vector3(
    (b.minM.x + b.maxM.x) / 2,
    (b.minM.y + b.maxM.y) / 2,
    (b.minM.z + b.maxM.z) / 2,
  );
};

/**
 * Where each part moves at full explode (factor 1), m. Parts move away from the machine's
 * centre along the direction they already lie in: off to the side → outwards, above or
 * below → up or down. Shells that share the centre (vessel, blanket, magnets, cryostat)
 * lift apart in order, the outermost highest. Structure stays put so the machine lifts
 * off its supports.
 */
export function explodeOffsets(
  components: readonly SimulationComponent[],
): ReadonlyMap<string, Vector3> {
  const out = new Map<string, Vector3>();
  if (components.length === 0) return out;
  const core = components.filter((c) => {
    const s = plantSystemOf(c);
    return s === "reactor" || s === "magnets";
  });
  const pool = core.length > 0 ? core : components;
  const centre = pool
    .reduce((acc, c) => acc.add(centreOf(c)), new Vector3())
    .multiplyScalar(1 / pool.length);
  for (const c of components) {
    if (plantSystemOf(c) === "structure") {
      out.set(c.id, new Vector3());
      continue;
    }
    const d = centreOf(c).sub(centre);
    const horizontal = Math.hypot(d.x, d.z);
    if (horizontal < 0.5 && Math.abs(d.y) < 0.5) {
      out.set(c.id, new Vector3(0, shellRank(c) * SHELL_LIFT_M, 0));
    } else if (Math.abs(d.y) > horizontal) {
      out.set(c.id, new Vector3(0, Math.sign(d.y) * (6 + 0.5 * Math.abs(d.y)), 0));
    } else {
      const k = (6 + 0.6 * horizontal) / horizontal;
      out.set(c.id, new Vector3(d.x * k, 0, d.z * k));
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------ *
 * Section plane
 * ------------------------------------------------------------------------------------ */

export interface SectionPlane {
  readonly axis: "x" | "y" | "z";
  /** Where the plane crosses its axis, m. */
  readonly offsetM: number;
  /** Keep the + side instead of the − side. */
  readonly flip: boolean;
}

/** The three.js clipping plane that keeps the chosen side (n·p + d ≥ 0 is kept). */
export function sectionClipPlane(section: SectionPlane, out = new Plane()): Plane {
  const n =
    section.axis === "x"
      ? new Vector3(1, 0, 0)
      : section.axis === "y"
        ? new Vector3(0, 1, 0)
        : new Vector3(0, 0, 1);
  // Default keeps the − side: n = −axis, d = offset.
  if (!section.flip) return out.set(n.negate(), section.offsetM);
  return out.set(n, -section.offsetM);
}

/**
 * Which cut the view shows: one section plane through the plant, the per-part cut that
 * opens each machine towards the camera (Cutaway, or the deepest peel level), or none.
 */
export function cutViewOf(view: {
  readonly cutaway: boolean;
  readonly peel: number;
  readonly section: unknown;
}): "section" | "camera" | "none" {
  if (view.section !== null) return "section";
  if (view.cutaway || view.peel >= PEEL_CUT_LEVEL) return "camera";
  return "none";
}
