import {
  PLANT_SYSTEMS,
  PLANT_SYSTEM_LABELS,
  plantSystemOf,
  type PlantSystem,
} from "@forgelab/reactor-components";
import { currentTransform, worldAabb, type SimulationComponent } from "@forgelab/sim-core";
import type { HallPlan, V3 } from "../environment/hall/plan.js";

/**
 * "Go to" places: one per plant system present in the design (derived from the parts, so
 * it can never go stale) and a few fixed vantage points of the building. Presentation
 * only: a bookmark moves a camera, nothing else.
 */
export interface Bookmark {
  readonly id: string;
  readonly kind: "system" | "hall";
  readonly label: string;
  /** "8 parts", or what the place is. */
  readonly detail: string;
  /** The parts of a system bookmark. */
  readonly ids: readonly string[];
  readonly system: PlantSystem | null;
  /** What to look at: the bounding box of the parts, or of the place. */
  readonly min: V3;
  readonly max: V3;
  /** A fixed eye position for a place of the building. */
  readonly eye: V3 | null;
}

export function systemBookmarks(components: readonly SimulationComponent[]): Bookmark[] {
  const groups = new Map<PlantSystem, { ids: string[]; min: number[]; max: number[] }>();
  for (const c of components) {
    const system = plantSystemOf(c);
    const box = worldAabb(c.geometry, currentTransform(c));
    let g = groups.get(system);
    if (g === undefined) {
      g = { ids: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      groups.set(system, g);
    }
    g.ids.push(c.id);
    g.min = [
      Math.min(g.min[0]!, box.minM.x),
      Math.min(g.min[1]!, box.minM.y),
      Math.min(g.min[2]!, box.minM.z),
    ];
    g.max = [
      Math.max(g.max[0]!, box.maxM.x),
      Math.max(g.max[1]!, box.maxM.y),
      Math.max(g.max[2]!, box.maxM.z),
    ];
  }
  const out: Bookmark[] = [];
  for (const system of PLANT_SYSTEMS) {
    const g = groups.get(system);
    if (g === undefined) continue;
    out.push({
      id: `system:${system}`,
      kind: "system",
      label: PLANT_SYSTEM_LABELS[system],
      detail: `${g.ids.length} ${g.ids.length === 1 ? "part" : "parts"}`,
      ids: g.ids,
      system,
      min: [g.min[0]!, g.min[1]!, g.min[2]!],
      max: [g.max[0]!, g.max[1]!, g.max[2]!],
      eye: null,
    });
  }
  return out;
}

export function hallBookmarks(plan: HallPlan | null): Bookmark[] {
  if (plan === null) return [];
  const place = (id: string, detail: string, view: HallPlan["views"]["eye"]): Bookmark => ({
    id: `hall:${id}`,
    kind: "hall",
    label: view.label,
    detail,
    ids: [],
    system: null,
    min: view.target,
    max: view.target,
    eye: view.position,
  });
  return [
    place("overview", "The whole building", plan.views.establishing),
    place("floor", "Eye level on the floor", plan.views.eye),
    place("gallery", "Up on the service level", plan.views.gallery),
    place("crane", "Under the crane girders", plan.views.crane),
  ];
}

const centreOf = (b: { min: V3; max: V3 }): V3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
];

/**
 * Where to stand on the floor to look at something: outside its footprint on the side
 * the viewer is already on, a few metres back (further for bigger things).
 */
export function standPoint(target: { min: V3; max: V3 }, from: V3): { eyeXZ: [number, number]; lookAt: V3 } {
  const c = centreOf(target);
  let dx = from[0] - c[0];
  let dz = from[2] - c[2];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    dx = 0;
    dz = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  const hx = (target.max[0] - target.min[0]) / 2;
  const hz = (target.max[2] - target.min[2]) / 2;
  // Distance from the centre to the footprint's edge along (dx, dz).
  const edge = Math.min(
    Math.abs(dx) > 1e-6 ? hx / Math.abs(dx) : Infinity,
    Math.abs(dz) > 1e-6 ? hz / Math.abs(dz) : Infinity,
  );
  const size = Math.hypot(hx, (target.max[1] - target.min[1]) / 2, hz);
  const back = Math.min(22, Math.max(4, size * 0.9));
  const height = Math.min(c[1], target.min[1] + 6);
  return {
    eyeXZ: [c[0] + dx * (edge + back), c[2] + dz * (edge + back)],
    lookAt: [c[0], Math.max(1.2, height), c[2]],
  };
}

/** A free-camera pose that frames something from the side the viewer is already on. */
export function vantage(
  target: { min: V3; max: V3 },
  from: V3,
  fovRad: number,
): { eye: V3; lookAt: V3 } {
  const c = centreOf(target);
  const radius = Math.max(
    1.5,
    Math.hypot(
      target.max[0] - target.min[0],
      target.max[1] - target.min[1],
      target.max[2] - target.min[2],
    ) / 2,
  );
  let dx = from[0] - c[0];
  let dy = from[1] - c[1];
  let dz = from[2] - c[2];
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) {
    dx = 0.6;
    dy = 0.45;
    dz = 0.66;
    d = Math.hypot(dx, dy, dz);
  }
  // Never from underneath: look slightly down at it.
  dy = Math.max(dy, d * 0.18);
  d = Math.hypot(dx, dy, dz);
  const distance = Math.min(400, Math.max(4, (radius / Math.sin(fovRad / 2)) * 1.15));
  return {
    eye: [c[0] + (dx / d) * distance, c[1] + (dy / d) * distance, c[2] + (dz / d) * distance],
    lookAt: c,
  };
}
