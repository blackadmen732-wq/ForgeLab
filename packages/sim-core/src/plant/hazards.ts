import { type RunawayData, getSubstance } from "@forgelab/materials";
import {
  STEFAN_BOLTZMANN_W_M2_K4,
  type Transform,
  type Vec3,
  worldPointToLocal,
} from "@forgelab/shared";
import { type SimulationComponent, componentCenterOfMassM } from "../component.js";
import { geometryOuterSurfaceM2, geometryVolumeM3 } from "../geometry.js";
import { SURFACE_EMISSIVITY } from "./constants.js";

/**
 * Spatial hazards: how a hot or burning part changes the world its unconnected neighbours
 * see. Radiant heat and fire travel through geometry, never through ports (CLAUDE.md §5,
 * §36). Each neighbour's own thermal model then decides what that heat does to it.
 *
 * REDUCED MODEL (confidence: approximate). Every part is an equivalent sphere with its
 * outer surface area, r = √(A / 4π), at its centre of mass. Between two spheres far apart
 * the exchange area is A₁F₁₂ = π r₁² r₂² / d² (the far-field view factor r₂² / 4d², which
 * is symmetric, so reciprocity holds). Overlapping spheres are held at touching distance;
 * one sphere entirely inside another is skipped, because the model cannot tell which
 * surfaces face each other.
 *
 * Shadowing: a third part that crosses the line between two others blocks part of what
 * they exchange (`occlusionTransmission`, cached by `ShadowIndex`). A box-shaped part —
 * a wall, a floor slab, a deck, a cabinet — blocks with its true oriented rectangle; other
 * shapes block with their equivalent sphere. A wall between a burning cable tray and a
 * battery cabinet protects the cabinet; a slab between two storeys separates them.
 */

/** Below this temperature on both surfaces a pair is not evaluated (culling, not physics). */
export const RADIANT_ONSET_K = 400;
/**
 * Pairs whose larger view factor is below this are never coupled: 1e-4 of a surface's
 * radiation is under 2 W from a 3 m² part at 1000 K. Culling, not physics.
 */
export const MIN_VIEW_FACTOR = 1e-4;
/**
 * Fraction of a fire's heat release emitted as thermal radiation. MODELLING CHOICE
 * following the point-source flame radiation model (NUREG-1805, Fire Dynamics Tools,
 * ch. 5: χr ≈ 0.30–0.40 for sooty hydrocarbon and polymer fires). The rest leaves in the
 * plume to the hall.
 */
export const FIRE_RADIANT_FRACTION = 0.35;

export interface HazardBody {
  readonly id: string;
  readonly centreM: Vec3;
  readonly radiusM: number;
  readonly areaM2: number;
  /** A box-shaped part's true extent, used when it stands in another pair's line of sight. */
  readonly box?: HazardBox;
}

/** An oriented box in world space: its frame (centre and local → world rotation) and half sizes. */
export interface HazardBox {
  readonly frame: Transform;
  readonly halfM: Vec3;
}

export interface HazardPair {
  readonly a: string;
  readonly b: string;
  /** Centre distance used by the model (never less than touching), m. */
  readonly distanceM: number;
  /** Exchange area A_a F_ab = A_b F_ba, m², before shadowing (see `ShadowIndex`). */
  readonly exchangeAreaM2: number;
}

export function equivalentRadiusM(areaM2: number): number {
  return Math.sqrt(Math.max(0, areaM2) / (4 * Math.PI));
}

export function hazardBody(component: SimulationComponent): HazardBody {
  const g = component.geometry;
  const areaM2 = geometryOuterSurfaceM2(g);
  const { positionM, rotation } = component.state.physical;
  return {
    id: component.id,
    centreM: componentCenterOfMassM(component),
    radiusM: equivalentRadiusM(areaM2),
    areaM2,
    ...(g.kind === "box"
      ? {
          box: {
            frame: { positionM, rotation },
            halfM: { x: g.sizeM.x / 2, y: g.sizeM.y / 2, z: g.sizeM.z / 2 },
          },
        }
      : {}),
  };
}

function toBoxLocal(box: HazardBox, p: Vec3): Vec3 {
  return worldPointToLocal(box.frame, p);
}

function insideBox(box: HazardBox, p: Vec3): boolean {
  const l = toBoxLocal(box, p);
  return (
    Math.abs(l.x) <= box.halfM.x && Math.abs(l.y) <= box.halfM.y && Math.abs(l.z) <= box.halfM.z
  );
}

/**
 * Whether the segment p→q passes through the box with both ends outside it (slab test in
 * the box's frame). A segment that starts or ends inside does not count: that end is
 * touching the box, not looking through it.
 */
export function segmentCrossesBox(box: HazardBox, p: Vec3, q: Vec3): boolean {
  const a = toBoxLocal(box, p);
  const b = toBoxLocal(box, q);
  const inside = (v: Vec3) =>
    Math.abs(v.x) <= box.halfM.x && Math.abs(v.y) <= box.halfM.y && Math.abs(v.z) <= box.halfM.z;
  if (inside(a) || inside(b)) return false;
  let t0 = 0;
  let t1 = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const d = b[axis] - a[axis];
    const h = box.halfM[axis];
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(a[axis]) > h) return false;
      continue;
    }
    let lo = (-h - a[axis]) / d;
    let hi = (h - a[axis]) / d;
    if (lo > hi) [lo, hi] = [hi, lo];
    t0 = Math.max(t0, lo);
    t1 = Math.min(t1, hi);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * The pair's modelled distance and exchange area, or null when the pair is not coupled
 * (nested, or too far apart to matter).
 */
export function pairGeometry(
  a: HazardBody,
  b: HazardBody,
): { distanceM: number; exchangeAreaM2: number } | null {
  const d = distance(a.centreM, b.centreM);
  const big = Math.max(a.radiusM, b.radiusM);
  const small = Math.min(a.radiusM, b.radiusM);
  if (small <= 0) return null;
  // One equivalent sphere entirely inside the other: no defined facing surfaces.
  if (d + small <= big) return null;
  const distanceM = Math.max(d, a.radiusM + b.radiusM);
  if ((big * big) / (4 * distanceM * distanceM) < MIN_VIEW_FACTOR) return null;
  return {
    distanceM,
    exchangeAreaM2: (Math.PI * a.radiusM ** 2 * b.radiusM ** 2) / distanceM ** 2,
  };
}

/**
 * Every coupled pair, in deterministic order (a < b by id). A uniform grid prunes pairs
 * that are too far apart; a body whose reach covers more cells than there are bodies is
 * tested against all of them instead.
 */
export function hazardPairs(bodies: readonly HazardBody[]): HazardPair[] {
  const sorted = [...bodies].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const cell = 4;
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
  const grid = new Map<string, number[]>();
  sorted.forEach((body, index) => {
    const c = cellOf(body.centreM, cell);
    const list = grid.get(key(c[0], c[1], c[2])) ?? [];
    list.push(index);
    grid.set(key(c[0], c[1], c[2]), list);
  });
  const seen = new Set<string>();
  const out: HazardPair[] = [];

  const consider = (i: number, j: number) => {
    if (i === j) return;
    const [lo, hi] = i < j ? [i, j] : [j, i];
    const pairKey = `${lo}:${hi}`;
    if (seen.has(pairKey)) return;
    seen.add(pairKey);
    const a = sorted[lo]!;
    const b = sorted[hi]!;
    const g = pairGeometry(a, b);
    if (g !== null) out.push({ a: a.id, b: b.id, ...g });
  };
  sorted.forEach((body, i) => {
    // A pair is coupled only within 1/(2√MIN_VIEW_FACTOR) of its larger radius, so each
    // pair is found from its larger member.
    const reach = body.radiusM / (2 * Math.sqrt(MIN_VIEW_FACTOR));
    const span = Math.ceil(reach / cell) + 1;
    if ((2 * span + 1) ** 3 > sorted.length) {
      for (let j = 0; j < sorted.length; j += 1) consider(i, j);
      return;
    }
    const c = cellOf(body.centreM, cell);
    for (let x = -span; x <= span; x += 1)
      for (let y = -span; y <= span; y += 1)
        for (let z = -span; z <= span; z += 1)
          for (const j of grid.get(key(c[0] + x, c[1] + y, c[2] + z)) ?? []) consider(i, j);
  });
  return out.sort((p, q) =>
    p.a !== q.a ? (p.a < q.a ? -1 : 1) : p.b < q.b ? -1 : p.b > q.b ? 1 : 0,
  );
}

/**
 * How much of the line of sight between a and b the other parts leave open.
 *
 * REDUCED MODEL (approximate). A part c shadows the pair when its equivalent sphere
 * crosses the segment between their centres, between their surfaces, and neither a nor b
 * sits inside it. The beam between two spheres is never wider than the smaller one, so c
 * blocks the fraction min(1, (r_c / r_small)²) of it; shadows combine multiplicatively.
 * It ignores how far along the beam c sits and penumbra, and cannot see a part that only
 * grazes the beam with its sphere outside the line.
 *
 * Box-shaped parts block with their oriented box instead: five parallel sight lines (the
 * centre line and four at half the smaller radius) are tested, and the open fraction is
 * the share that no box crosses with both ends outside it (lines running below the ground
 * plane are left out: the floor is opaque). A wall or slab therefore blocks
 * by where it actually is, however long and thin, and a part touching it is still seen
 * as being against it rather than through it. Boxes enclosing a or b are skipped as rooms
 * are: what is inside sees the walls themselves.
 */
export function occlusionTransmission(
  a: HazardBody,
  b: HazardBody,
  others: readonly HazardBody[],
  groundLevelM = -Infinity,
): { transmission: number; shadowedBy: string[] } {
  const ab = {
    x: b.centreM.x - a.centreM.x,
    y: b.centreM.y - a.centreM.y,
    z: b.centreM.z - a.centreM.z,
  };
  const length = Math.hypot(ab.x, ab.y, ab.z);
  if (length <= 0) return { transmission: 1, shadowedBy: [] };
  const small = Math.min(a.radiusM, b.radiusM);
  let transmission = 1;
  const shadowedBy: string[] = [];
  const boxes: HazardBody[] = [];
  for (const c of others) {
    if (c.id === a.id || c.id === b.id || c.radiusM <= 0) continue;
    if (c.box !== undefined) {
      // Parts inside the box (a room's walls, a hollow enclosure) are enclosed, not shadowed.
      if (!insideBox(c.box, a.centreM) && !insideBox(c.box, b.centreM)) boxes.push(c);
      continue;
    }
    // Parts that contain either end are enclosures, not shadows.
    if (distance(c.centreM, a.centreM) <= c.radiusM || distance(c.centreM, b.centreM) <= c.radiusM)
      continue;
    const ac = {
      x: c.centreM.x - a.centreM.x,
      y: c.centreM.y - a.centreM.y,
      z: c.centreM.z - a.centreM.z,
    };
    const along = (ac.x * ab.x + ac.y * ab.y + ac.z * ab.z) / length;
    if (along <= a.radiusM || along >= length - b.radiusM) continue;
    const perp = Math.sqrt(Math.max(0, ac.x ** 2 + ac.y ** 2 + ac.z ** 2 - along * along));
    if (perp >= c.radiusM) continue;
    transmission *= 1 - Math.min(1, (c.radiusM / small) ** 2);
    shadowedBy.push(c.id);
    if (transmission <= 0) return { transmission: 0, shadowedBy };
  }
  if (boxes.length > 0) {
    // Five parallel sight lines across the beam (its axis and four at half the smaller
    // radius); the open fraction is the share no box crosses.
    const n = { x: ab.x / length, y: ab.y / length, z: ab.z / length };
    const helper = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const u = normalize(cross(n, helper));
    const v = cross(n, u);
    const s = 0.5 * small;
    const offsets = [{ x: 0, y: 0, z: 0 }, scale(u, s), scale(u, -s), scale(v, s), scale(v, -s)];
    const blockers = new Set<string>();
    let open = 0;
    let seen = 0;
    for (const o of offsets) {
      const p = add(a.centreM, o);
      const q = add(b.centreM, o);
      // A sight line that runs below the floor is not part of the beam: the ground is
      // opaque, so it can neither pass under a wall nor count as open. The centre line
      // always counts.
      if (o !== offsets[0] && (p.y < groundLevelM || q.y < groundLevelM)) continue;
      seen += 1;
      const hit = boxes.find((c) => segmentCrossesBox(c.box!, p, q));
      if (hit === undefined) open += 1;
      else blockers.add(hit.id);
    }
    transmission *= open / seen;
    shadowedBy.push(...[...blockers].sort());
  }
  return { transmission, shadowedBy };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/**
 * Net radiant heat from a to b, W (negative when b is the hotter): grey bodies with small
 * view factors, ε_a ε_b σ A_a F_ab (T_a⁴ − T_b⁴).
 */
export function radiantExchangeW(exchangeAreaM2: number, ta: number, tb: number): number {
  return (
    SURFACE_EMISSIVITY *
    SURFACE_EMISSIVITY *
    STEFAN_BOLTZMANN_W_M2_K4 *
    exchangeAreaM2 *
    (ta ** 4 - tb ** 4)
  );
}

/**
 * Flame radiation absorbed by a neighbour: a point source at the burning part's centre
 * radiating χr·Q evenly, intercepted by the neighbour's cross-section π r² at distance d
 * and absorbed with its emissivity.
 */
export function fireRadiationAbsorbedW(
  heatReleaseW: number,
  targetRadiusM: number,
  distanceM: number,
): number {
  if (distanceM <= 0) return 0;
  return (
    (SURFACE_EMISSIVITY * FIRE_RADIANT_FRACTION * heatReleaseW * targetRadiusM ** 2) /
    (4 * distanceM ** 2)
  );
}

/** What a part carries that can burn, and how it burns (sourced material data only). */
export interface FuelInventory {
  readonly kg: number;
  /** Lowest ignition temperature among its burnable regions, K. */
  readonly ignitionK: number;
  /** Mass-weighted effective heat of combustion, J/kg. */
  readonly heatOfCombustionJPerKg: number;
  /** Mass-weighted free-burning rate, kg/(m²·s). */
  readonly burningRateKgM2S: number;
  /** Names of the burnable regions, for explanations. */
  readonly regionNames: readonly string[];
  readonly substanceIds: readonly string[];
}

/**
 * The burnable inventory of a part: its regions whose substance has sourced ignition and
 * burning data (a solid part burns if its own material does). Null when nothing burns.
 */
export function fuelInventory(component: SimulationComponent): FuelInventory | null {
  const volumeM3 = geometryVolumeM3(component.geometry);
  const regions =
    component.composition.length > 0
      ? component.composition.map((r) => ({
          name: r.name,
          substanceId: r.substanceId,
          volumeM3: r.volumeFraction * volumeM3,
        }))
      : [{ name: component.label || component.id, substanceId: component.materialId, volumeM3 }];
  let kg = 0;
  let heat = 0;
  let rate = 0;
  let ignitionK = Infinity;
  const names: string[] = [];
  const ids: string[] = [];
  for (const region of regions) {
    const substance = getSubstance(region.substanceId);
    if (substance.combustion === undefined || substance.ignitionK === undefined) continue;
    const m = region.volumeM3 * substance.densityKgM3;
    if (!(m > 0)) continue;
    kg += m;
    heat += m * substance.combustion.heatOfCombustionJPerKg;
    rate += m * substance.combustion.burningRateKgM2S;
    ignitionK = Math.min(ignitionK, substance.ignitionK);
    names.push(region.name);
    ids.push(region.substanceId);
  }
  if (kg <= 0) return null;
  return {
    kg,
    ignitionK,
    heatOfCombustionJPerKg: heat / kg,
    burningRateKgM2S: rate / kg,
    regionNames: names,
    substanceIds: ids,
  };
}

/**
 * Regions that can ignite but whose burning is not sourced: the model reports them above
 * their ignition temperature rather than inventing a fire.
 */
export function unmodelledCombustibles(
  component: SimulationComponent,
): readonly { readonly name: string; readonly substanceId: string; readonly ignitionK: number }[] {
  const regions =
    component.composition.length > 0
      ? component.composition.map((r) => ({ name: r.name, substanceId: r.substanceId }))
      : [{ name: component.label || component.id, substanceId: component.materialId }];
  const out: { name: string; substanceId: string; ignitionK: number }[] = [];
  for (const region of regions) {
    const substance = getSubstance(region.substanceId);
    if (substance.ignitionK !== undefined && substance.combustion === undefined)
      out.push({ ...region, ignitionK: substance.ignitionK });
  }
  return out;
}

/**
 * Shadowing for coupled pairs, computed lazily: only pairs that actually exchange heat
 * (a hot surface or a fire) are ever asked, and each answer is cached for the design.
 *
 * Candidate shadows are found without testing every part: parts no bigger than a grid
 * cell are looked up in the cells the segment passes through and their neighbours; the
 * few bigger ones are always candidates. `occlusionTransmission` makes the decision.
 */
export class ShadowIndex {
  readonly #grid = new Map<string, number[]>();
  readonly #large: number[] = [];
  readonly #bodies: readonly HazardBody[];
  readonly #cell: number;

  readonly #byId = new Map<string, HazardBody>();
  readonly #cache = new Map<string, { transmission: number; shadowedBy: string[] }>();

  readonly #groundLevelM: number;

  constructor(bodies: readonly HazardBody[], cell = 4, groundLevelM = -Infinity) {
    this.#groundLevelM = groundLevelM;
    this.#bodies = [...bodies].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    this.#cell = cell;
    for (const body of this.#bodies) this.#byId.set(body.id, body);
    bodies = this.#bodies;
    bodies.forEach((body, index) => {
      // A box can reach further than its equivalent sphere (a long wall): boxes are always
      // candidates unless their half-diagonal is well inside one cell.
      const large = body.box
        ? Math.hypot(body.box.halfM.x, body.box.halfM.y, body.box.halfM.z) > cell / 2
        : body.radiusM > cell;
      if (large) {
        this.#large.push(index);
        return;
      }
      const c = cellOf(body.centreM, cell);
      const k = `${c[0]},${c[1]},${c[2]}`;
      const list = this.#grid.get(k);
      if (list === undefined) this.#grid.set(k, [index]);
      else list.push(index);
    });
  }

  readonly #byPair = new Map<HazardPair, number>();

  /** Open fraction for a coupled pair; cached on the pair object (hot-path lookup). */
  forPair(pair: HazardPair): number {
    let t = this.#byPair.get(pair);
    if (t === undefined) {
      t = this.between(pair.a, pair.b).transmission;
      this.#byPair.set(pair, t);
    }
    return t;
  }

  /** Fraction of the line of sight between two parts left open, and who blocks it. */
  between(aId: string, bId: string): { transmission: number; shadowedBy: readonly string[] } {
    const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    let result = this.#cache.get(key);
    if (result === undefined) {
      const a = this.#byId.get(aId)!;
      const b = this.#byId.get(bId)!;
      result = occlusionTransmission(a, b, this.#along(a, b), this.#groundLevelM);
      this.#cache.set(key, result);
    }
    return result;
  }

  #along(a: HazardBody, b: HazardBody): HazardBody[] {
    const found = new Set<number>(this.#large);
    const d = distance(a.centreM, b.centreM);
    const steps = Math.max(1, Math.ceil(d / (this.#cell / 2)));
    const visited = new Set<string>();
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const p = {
        x: a.centreM.x + (b.centreM.x - a.centreM.x) * t,
        y: a.centreM.y + (b.centreM.y - a.centreM.y) * t,
        z: a.centreM.z + (b.centreM.z - a.centreM.z) * t,
      };
      const c = cellOf(p, this.#cell);
      for (let x = -1; x <= 1; x += 1)
        for (let y = -1; y <= 1; y += 1)
          for (let z = -1; z <= 1; z += 1) {
            const k = `${c[0] + x},${c[1] + y},${c[2] + z}`;
            if (visited.has(k)) continue;
            visited.add(k);
            for (const i of this.#grid.get(k) ?? []) found.add(i);
          }
    }
    return [...found].sort((x, y) => x - y).map((i) => this.#bodies[i]!);
  }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function cellOf(p: Vec3, size: number): [number, number, number] {
  return [Math.floor(p.x / size), Math.floor(p.y / size), Math.floor(p.z / size)];
}

/* ------------------------------------------------------------------------------------ *
 * Battery cells: self-heating and thermal runaway
 * ------------------------------------------------------------------------------------ */

/**
 * Self-heating rates that define T1 and T2 in accelerating-rate calorimetry (Feng et al.,
 * 2018): 0.02 K/min at the onset of self-heating, 1 K/s at the runaway trigger.
 */
export const SELF_HEATING_ONSET_RATE_K_PER_S = 0.02 / 60;
export const RUNAWAY_TRIGGER_RATE_K_PER_S = 1;

/** What a part holds that can run away, and how (sourced cell data only). */
export interface CellInventory {
  readonly kg: number;
  /** Heat capacity of the cells alone, J/K. */
  readonly heatCapacityJK: number;
  /** Chemistry of the heaviest cell region (one chemistry per part). */
  readonly runaway: RunawayData;
  readonly substanceId: string;
  readonly regionNames: readonly string[];
  /**
   * Arrhenius self-heating dT/dt = A·exp(−B/T), with A and B calibrated so the rate is
   * 0.02 K/min at T1 and 1 K/s at T2. Nothing else sets the rate.
   */
  readonly arrheniusA: number;
  readonly arrheniusB: number;
}

/**
 * The cells of a part: its regions whose substance has sourced runaway data. Null when it
 * holds none.
 *
 * REDUCED MODEL (approximate). A part is one lumped temperature, so a module's cells heat
 * and run away together; propagation happens between parts (modules), through joints and
 * through space. Model a rack as several module parts to see module-to-module spread.
 */
export function cellInventory(component: SimulationComponent): CellInventory | null {
  const volumeM3 = geometryVolumeM3(component.geometry);
  let kg = 0;
  let heatCapacityJK = 0;
  let heaviest: { kg: number; id: string; data: RunawayData } | null = null;
  const names: string[] = [];
  for (const region of component.composition) {
    const substance = getSubstance(region.substanceId);
    const data = substance.thermalRunaway;
    if (data === undefined) continue;
    const m = region.volumeFraction * volumeM3 * substance.densityKgM3;
    if (!(m > 0)) continue;
    kg += m;
    heatCapacityJK += m * (substance.specificHeatJkgK ?? 0);
    names.push(region.name);
    if (heaviest === null || m > heaviest.kg) heaviest = { kg: m, id: substance.id, data };
  }
  if (heaviest === null || kg <= 0 || heatCapacityJK <= 0) return null;
  const { selfHeatingOnsetK: t1, triggerK: t2 } = heaviest.data;
  const arrheniusB =
    Math.log(RUNAWAY_TRIGGER_RATE_K_PER_S / SELF_HEATING_ONSET_RATE_K_PER_S) / (1 / t1 - 1 / t2);
  const arrheniusA = SELF_HEATING_ONSET_RATE_K_PER_S * Math.exp(arrheniusB / t1);
  return {
    kg,
    heatCapacityJK,
    runaway: heaviest.data,
    substanceId: heaviest.id,
    regionNames: names,
    arrheniusA,
    arrheniusB,
  };
}

/** Heat the cells generate by their own decomposition at temperature T, W. */
export function selfHeatingW(cells: CellInventory, temperatureK: number): number {
  return cells.heatCapacityJK * cells.arrheniusA * Math.exp(-cells.arrheniusB / temperatureK);
}

/**
 * Energy runaway releases once triggered: the adiabatic rise of the cells from T2 to T3.
 * T3 is measured on charged cells, so this already contains the electrochemical energy.
 */
export function runawayEnergyJ(cells: CellInventory): number {
  return cells.heatCapacityJK * (cells.runaway.maximumK - cells.runaway.triggerK);
}
