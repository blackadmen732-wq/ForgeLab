import {
  ATOMIC_MASS_UNIT_KG,
  BOLTZMANN_J_PER_K,
  type Vec3,
  Vec3Math,
  localDirectionToWorld,
  localPointToWorld,
  vec3,
} from "@forgelab/shared";
import { type SimulationComponent, currentTransform } from "../component.js";
import { arcPoint, arcTangent, geometryInteriorSurfaceM2 } from "../geometry.js";
import type { PlantLink } from "./topology.js";

/**
 * Free-form vacuum chambers.
 *
 * A chamber is the vacuum region one or more vessel segments enclose. Segments joined
 * flange to flange (a direct vacuum connection between two vessels, not a run of duct)
 * share one vacuum: one pressure, the sum of their volumes and wall areas, the union of the
 * pumps, injectors and heaters fitted to any of them. The lead segment (lowest id) carries
 * the chamber's state and plasma parameters.
 *
 * What the chamber IS comes from how its segments join, never from a reactor-type name:
 *
 *  - loop     every segment joins two others and they close on themselves: a ring-shaped
 *             plasma volume (toroidal). The plasma model sees a torus whose major radius
 *             is the centreline length / 2π and whose minor radius is the narrowest bore.
 *  - chain    the segments join end to end and stop: an open (linear) plasma column of
 *             the centreline's length.
 *  - branched anything else (a tee, a cross, a torus with a duct on it). ForgeLab computes
 *             its vacuum, but has no plasma model for it: confidence UNSUPPORTED.
 *
 * A single torus or cylinder vessel is the analytic case ("single") the solver has always
 * handled; nothing about it changes.
 *
 * An end flange left unjoined (a "chamber-end" vacuum port with nothing on it) is an
 * opening to the hall: the solver lets gas in through it (`openingConductanceM3PerS`).
 */
export type ChamberPath = "single" | "loop" | "chain" | "branched";

export interface CentrelineSample {
  readonly point: Vec3;
  /** Unit direction of the centreline at the point, consistent along the chamber. */
  readonly tangent: Vec3;
}

export interface ChamberOpening {
  readonly componentId: string;
  readonly connectionPointId: string;
  readonly areaM2: number;
}

export interface ChamberShape {
  /** Segment ids, sorted; the first is the lead. */
  readonly memberIds: readonly string[];
  readonly path: ChamberPath;
  /** Length of the centreline, m (0 for single and branched). */
  readonly lengthM: number;
  /** Narrowest inner radius along the chamber, m. */
  readonly boreRadiusM: number;
  /** Ordered world-space samples of the centreline (empty for single and branched). */
  readonly centreline: readonly CentrelineSample[];
  /** Loop: centreline length / 2π, m. Otherwise 0. */
  readonly majorRadiusM: number;
  /**
   * How far the centreline departs from the shape the plasma model assumes, m: for a loop,
   * the spread of its distance from the loop's centre plus any out-of-plane excursion; for
   * a chain, the furthest the centreline strays from the straight line between its ends.
   */
  readonly departureM: number;
  /** True when that departure is small enough for the model's shape (see `regular`). */
  readonly regular: boolean;
  /** Unjoined end flanges: where the chamber is open to the hall. */
  readonly openings: readonly ChamberOpening[];
}

/** Centreline samples for a chamber, spread along it in proportion to length. */
const CENTRELINE_SAMPLES = 48;
/** A loop is "circular" when its radius varies by at most this fraction. */
const LOOP_REGULAR_FRACTION = 0.1;
/** A chain is "straight" when its centreline stays within this fraction of the bore. */
const CHAIN_REGULAR_FRACTION = 0.25;

function innerRadiusM(component: SimulationComponent): number {
  const g = component.geometry;
  const t = g.wallThicknessM ?? 0;
  switch (g.kind) {
    case "cylinder":
    case "arc":
      return Math.max(0, g.radiusM - t);
    case "torus":
      return Math.max(0, g.minorRadiusM - t);
    case "box":
      return 0;
  }
}

/** A segment's centreline as a parametric path, u ∈ [0, 1], in world space. */
interface SegmentPath {
  readonly lengthM: number;
  at(u: number): CentrelineSample;
}

function segmentPath(component: SimulationComponent): SegmentPath | null {
  const g = component.geometry;
  const t = currentTransform(component);
  if (g.kind === "cylinder") {
    const local = g.axis === "x" ? vec3(1, 0, 0) : g.axis === "y" ? vec3(0, 1, 0) : vec3(0, 0, 1);
    const tangent = localDirectionToWorld(t, local);
    const start = localPointToWorld(t, Vec3Math.scale(local, -g.heightM / 2));
    return {
      lengthM: g.heightM,
      at: (u) => ({ point: Vec3Math.add(start, Vec3Math.scale(tangent, u * g.heightM)), tangent }),
    };
  }
  if (g.kind === "arc") {
    return {
      lengthM: g.bendRadiusM * g.sweepRad,
      at: (u) => {
        const s = -g.sweepRad / 2 + u * g.sweepRad;
        return {
          point: localPointToWorld(t, arcPoint(g, s)),
          tangent: Vec3Math.normalize(localDirectionToWorld(t, arcTangent(g, s))),
        };
      },
    };
  }
  return null;
}

function reversed(path: SegmentPath): SegmentPath {
  return {
    lengthM: path.lengthM,
    at: (u) => {
      const s = path.at(1 - u);
      return { point: s.point, tangent: Vec3Math.scale(s.tangent, -1) };
    },
  };
}

/** World position of a link's socket on `componentId`. */
function socketOn(
  link: PlantLink,
  componentId: string,
  byId: ReadonlyMap<string, SimulationComponent>,
): Vec3 | undefined {
  const end = link.a === componentId ? link.connection.from : link.connection.to;
  const component = byId.get(componentId);
  const point = component?.connectionPoints.find((p) => p.id === end.connectionPointId);
  if (component === undefined || point === undefined) return undefined;
  return localPointToWorld(currentTransform(component), point.localPosition);
}

/** Unjoined chamber-end flanges among the members. */
function openingsOf(
  members: readonly SimulationComponent[],
  vacuumLinks: readonly PlantLink[],
): ChamberOpening[] {
  const used = new Set<string>();
  for (const link of vacuumLinks) {
    used.add(`${link.connection.from.componentId}\u0000${link.connection.from.connectionPointId}`);
    used.add(`${link.connection.to.componentId}\u0000${link.connection.to.connectionPointId}`);
  }
  const out: ChamberOpening[] = [];
  for (const member of members) {
    for (const point of member.connectionPoints) {
      const port = point.port;
      if (port?.domain !== "vacuum" || port.opening !== "chamber-end") continue;
      if (used.has(`${member.id}\u0000${point.id}`)) continue;
      out.push({
        componentId: member.id,
        connectionPointId: point.id,
        areaM2: (Math.PI * port.flangeDiameterM ** 2) / 4,
      });
    }
  }
  return out;
}

/**
 * Groups hollow vessels into chambers and works out each one's shape. `vessels` must be
 * sorted by id; `vacuumLinks` are all vacuum links in the design.
 */
export function buildChambers(
  vessels: readonly SimulationComponent[],
  vacuumLinks: readonly PlantLink[],
  byId: ReadonlyMap<string, SimulationComponent>,
): ChamberShape[] {
  const isVessel = new Set(vessels.map((v) => v.id));
  // Flange-to-flange joints between two different segments.
  const joints = vacuumLinks.filter(
    (l) => !l.run && l.a !== l.b && isVessel.has(l.a) && isVessel.has(l.b),
  );
  const jointsOf = new Map<string, PlantLink[]>(vessels.map((v) => [v.id, []]));
  for (const j of joints) {
    jointsOf.get(j.a)!.push(j);
    jointsOf.get(j.b)!.push(j);
  }
  for (const list of jointsOf.values())
    list.sort((x, y) => (x.connection.id < y.connection.id ? -1 : 1));

  const seen = new Set<string>();
  const chambers: ChamberShape[] = [];
  for (const start of vessels) {
    if (seen.has(start.id)) continue;
    const group: string[] = [];
    const stack = [start.id];
    seen.add(start.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      group.push(id);
      for (const j of jointsOf.get(id)!) {
        const other = j.a === id ? j.b : j.a;
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    group.sort();
    const members = group.map((id) => byId.get(id)!);
    chambers.push(shapeOf(members, jointsOf, vacuumLinks, byId));
  }
  return chambers;
}

function shapeOf(
  members: readonly SimulationComponent[],
  jointsOf: ReadonlyMap<string, readonly PlantLink[]>,
  vacuumLinks: readonly PlantLink[],
  byId: ReadonlyMap<string, SimulationComponent>,
): ChamberShape {
  const memberIds = members.map((m) => m.id);
  const boreRadiusM = Math.min(...members.map(innerRadiusM));
  const openings = openingsOf(members, vacuumLinks);
  const base = { memberIds, boreRadiusM, openings };
  const flat = {
    lengthM: 0,
    centreline: [],
    majorRadiusM: 0,
    departureM: 0,
    regular: true,
  };

  const lead = members[0]!;
  if (members.length === 1 && lead.geometry.kind !== "arc")
    return { ...base, ...flat, path: "single" };

  const degree = (id: string) => jointsOf.get(id)!.length;
  const jointCount = members.reduce((n, m) => n + degree(m.id), 0) / 2;
  const paths = members.map(segmentPath);
  const chainLike = members.every((m) => degree(m.id) <= 2) && paths.every((p) => p !== null);
  const loop = chainLike && jointCount === members.length;
  const chain = chainLike && jointCount === members.length - 1;
  if (!loop && !chain) return { ...base, ...flat, path: "branched" };

  // Walk the segments in order, turning each so it continues from the one before.
  const pathOf = new Map(members.map((m, i) => [m.id, paths[i]!]));
  const first = loop ? lead : members.find((m) => degree(m.id) <= 1)!;
  const ordered: SegmentPath[] = [];
  let current = first;
  let incoming: PlantLink | undefined = loop ? jointsOf.get(first.id)![0] : undefined;
  for (let k = 0; k < members.length; k += 1) {
    const path = pathOf.get(current.id)!;
    const outgoing = jointsOf.get(current.id)!.find((j) => j !== incoming);
    const start = path.at(0).point;
    const end = path.at(1).point;
    let flip = false;
    const entry = incoming === undefined ? undefined : socketOn(incoming, current.id, byId);
    const exit = outgoing === undefined ? undefined : socketOn(outgoing, current.id, byId);
    if (entry !== undefined) flip = Vec3Math.distance(entry, end) < Vec3Math.distance(entry, start);
    else if (exit !== undefined)
      flip = Vec3Math.distance(exit, start) < Vec3Math.distance(exit, end);
    ordered.push(flip ? reversed(path) : path);
    if (outgoing === undefined) break;
    current = byId.get(outgoing.a === current.id ? outgoing.b : outgoing.a)!;
    incoming = outgoing;
  }

  const lengthM = ordered.reduce((sum, p) => sum + p.lengthM, 0);
  const centreline: CentrelineSample[] = [];
  for (const p of ordered) {
    const n = Math.max(2, Math.round((CENTRELINE_SAMPLES * p.lengthM) / Math.max(lengthM, 1e-9)));
    for (let j = 0; j < n; j += 1) centreline.push(p.at((j + 0.5) / n));
  }

  if (loop) {
    const centre = Vec3Math.scale(
      centreline.reduce((acc, s) => Vec3Math.add(acc, s.point), vec3(0, 0, 0)),
      1 / centreline.length,
    );
    // Loop normal from the swept area (sum of r × dr), robust for any planar loop.
    let normal = vec3(0, 0, 0);
    for (let i = 0; i < centreline.length; i += 1) {
      const a = Vec3Math.subtract(centreline[i]!.point, centre);
      const b = Vec3Math.subtract(centreline[(i + 1) % centreline.length]!.point, centre);
      normal = Vec3Math.add(normal, Vec3Math.cross(a, b));
    }
    normal = Vec3Math.length(normal) > 0 ? Vec3Math.normalize(normal) : vec3(0, 1, 0);
    const radii = centreline.map((s) => Vec3Math.distance(s.point, centre));
    const offPlane = Math.max(
      ...centreline.map((s) => Math.abs(Vec3Math.dot(Vec3Math.subtract(s.point, centre), normal))),
    );
    const majorRadiusM = lengthM / (2 * Math.PI);
    const departureM = Math.max(...radii) - Math.min(...radii) + offPlane;
    return {
      ...base,
      path: "loop",
      lengthM,
      centreline,
      majorRadiusM,
      departureM,
      regular: departureM <= LOOP_REGULAR_FRACTION * majorRadiusM,
    };
  }

  const a = ordered[0]!.at(0).point;
  const b = ordered[ordered.length - 1]!.at(1).point;
  const ab = Vec3Math.subtract(b, a);
  const span = Vec3Math.length(ab);
  const dir = span > 0 ? Vec3Math.scale(ab, 1 / span) : vec3(0, 1, 0);
  const departureM = Math.max(
    ...centreline.map((s) => {
      const r = Vec3Math.subtract(s.point, a);
      return Vec3Math.length(Vec3Math.subtract(r, Vec3Math.scale(dir, Vec3Math.dot(r, dir))));
    }),
  );
  return {
    ...base,
    path: "chain",
    lengthM,
    centreline,
    majorRadiusM: 0,
    departureM,
    regular: departureM <= CHAIN_REGULAR_FRACTION * Math.max(boreRadiusM, 1e-9),
  };
}

/** Interior wall area of each member, for splitting wall heat across a chamber. */
export function wallShares(
  memberIds: readonly string[],
  byId: ReadonlyMap<string, SimulationComponent>,
): { id: string; share: number }[] {
  if (memberIds.length === 1) return [{ id: memberIds[0]!, share: 1 }];
  const areas = memberIds.map((id) => geometryInteriorSurfaceM2(byId.get(id)!.geometry));
  const total = areas.reduce((s, x) => s + x, 0);
  return memberIds.map((id, i) => ({
    id,
    share: total > 0 ? areas[i]! / total : 1 / memberIds.length,
  }));
}

/**
 * Molecular-flow conductance of the chamber's openings to the hall, m³/s: kinetic theory
 * gives an orifice conductance of v̄/4 per unit area, v̄ = √(8kT/πm) the mean molecular
 * speed of air (293.15 K, 28.97 u): ≈ 116 m/s, i.e. the textbook 11.6 L/(s·cm²). Real
 * flow through an opening at atmospheric pressure is viscous and larger still, so this is a
 * lower bound on the leak: an open chamber cannot be pumped down either way.
 */
export function openingConductanceM3PerS(openings: readonly ChamberOpening[]): number {
  const area = openings.reduce((s, o) => s + o.areaM2, 0);
  return area * AIR_ORIFICE_CONDUCTANCE_M_PER_S;
}

/** Mean molar mass of dry air, u. */
const AIR_MOLAR_MASS_U = 28.97;
const HALL_TEMPERATURE_K = 293.15;
const AIR_ORIFICE_CONDUCTANCE_M_PER_S =
  Math.sqrt(
    (8 * BOLTZMANN_J_PER_K * HALL_TEMPERATURE_K) /
      (Math.PI * AIR_MOLAR_MASS_U * ATOMIC_MASS_UNIT_KG),
  ) / 4;
