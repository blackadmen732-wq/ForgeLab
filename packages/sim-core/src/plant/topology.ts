import { type Vec3, Vec3Math, localPointToWorld } from "@forgelab/shared";
import { type SimulationComponent, currentTransform } from "../component.js";
import type { Connection, ConnectionType } from "../connections.js";
import { CONNECTION_SNAP_TOLERANCE_M } from "../connections.js";
import { cylinderSurroundsCoaxially, coaxialRelation, torusEnclosesTorus } from "./magnetics.js";
import type { PlantRole } from "./roles.js";
import { torusWinding } from "./biotSavart.js";
import { type ChamberShape, buildChambers } from "./chamber.js";

/** A plant link: one connection with both endpoints resolved and its physical length. */
export interface PlantLink {
  readonly connection: Connection;
  readonly a: string;
  readonly b: string;
  /** Distance between the two sockets, m. */
  readonly lengthM: number;
  /** True when the sockets are further apart than the snap tolerance: an implicit cable/hose run. */
  readonly run: boolean;
}

export interface VesselLayout {
  /** The chamber's lead segment (lowest id): it carries the chamber's state. */
  readonly vesselId: string;
  /**
   * The plasma model the chamber's shape calls for, derived from geometry: a closed ring
   * ("tokamak": toroidal, plasma current driven) or an open column ("linear"); "none" when
   * ForgeLab has no plasma model for the shape.
   */
  readonly configuration: "tokamak" | "linear" | "none";
  /** Every segment of the chamber (lead first) and how they join (chamber.ts). */
  readonly chamber: ChamberShape;
  /** Coils whose field ForgeLab can compute at this vessel's plasma. */
  readonly coilIds: readonly string[];
  readonly blanketIds: readonly string[];
  readonly heaterIds: readonly string[];
  readonly injectorIds: readonly string[];
  readonly pumpIds: readonly string[];
}

export interface PlantTopology {
  readonly byId: ReadonlyMap<string, SimulationComponent>;
  readonly links: ReadonlyMap<ConnectionType, readonly PlantLink[]>;
  readonly vessels: readonly VesselLayout[];
  /** Coil id → vessel id it serves. */
  readonly coilVessel: ReadonlyMap<string, string>;
  readonly blanketVessel: ReadonlyMap<string, string>;
  /** Coils present that do not serve any vessel in a computable way. */
  readonly orphanCoilIds: readonly string[];
  readonly orphanBlanketIds: readonly string[];
}

export function socketWorldPoint(
  component: SimulationComponent,
  socketId: string,
): Vec3 | undefined {
  const socket = component.connectionPoints.find((point) => point.id === socketId);
  if (socket === undefined) return undefined;
  return localPointToWorld(currentTransform(component), socket.localPosition);
}

export function neighbours(topology: PlantTopology, type: ConnectionType, id: string): string[] {
  const result: string[] = [];
  for (const link of topology.links.get(type) ?? []) {
    if (link.a === id) result.push(link.b);
    else if (link.b === id) result.push(link.a);
  }
  return result.sort();
}

export function roleOf(topology: PlantTopology, id: string): PlantRole | undefined {
  return topology.byId.get(id)?.role;
}

function isHollow(component: SimulationComponent): boolean {
  return component.geometry.wallThicknessM !== undefined && component.geometry.kind !== "box";
}

export function buildTopology(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
): PlantTopology {
  const byId = new Map(components.map((component) => [component.id, component]));
  const links = new Map<ConnectionType, PlantLink[]>();
  for (const connection of connections) {
    const a = byId.get(connection.from.componentId);
    const b = byId.get(connection.to.componentId);
    if (a === undefined || b === undefined) continue;
    const pa = socketWorldPoint(a, connection.from.connectionPointId);
    const pb = socketWorldPoint(b, connection.to.connectionPointId);
    const lengthM = pa !== undefined && pb !== undefined ? Vec3Math.distance(pa, pb) : 0;
    const bucket = links.get(connection.type) ?? [];
    bucket.push({
      connection,
      a: a.id,
      b: b.id,
      lengthM,
      run: lengthM > CONNECTION_SNAP_TOLERANCE_M,
    });
    links.set(connection.type, bucket);
  }

  const sorted = [...components].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const vesselComponents = sorted.filter(
    (component) => component.role === "vacuum-vessel" && isHollow(component),
  );
  const coils = sorted.filter((component) => component.role === "magnet-coil");
  const blankets = sorted.filter((component) => component.role === "blanket");

  const coilVessel = new Map<string, string>();
  const blanketVessel = new Map<string, string>();
  const placementOf = (component: SimulationComponent) => ({
    geometry: component.geometry,
    placement: currentTransform(component),
  });

  const partial = { byId, links } as unknown as PlantTopology;
  const chambers = buildChambers(vesselComponents, links.get("vacuum") ?? [], byId);
  const vessels: VesselLayout[] = chambers.map((chamber) => {
    const vessel = byId.get(chamber.memberIds[0]!)!;
    const configuration =
      chamber.path === "single"
        ? vessel.geometry.kind === "torus"
          ? "tokamak"
          : vessel.geometry.kind === "cylinder"
            ? "linear"
            : "none"
        : chamber.path === "loop"
          ? "tokamak"
          : chamber.path === "chain"
            ? "linear"
            : "none";
    // The analytic field and blanket models describe a single torus or cylinder; coils
    // round an assembled chamber reach it through their computed field (fieldCoupling.ts).
    const analytic = chamber.path === "single";
    const coilIds: string[] = [];
    for (const coil of analytic ? coils : []) {
      if (coilVessel.has(coil.id)) continue;
      // Only a toroidal winding makes the toroidal field the analytic model assumes; a
      // loop-wound torus (a circular coil) is handled geometrically (fieldCoupling.ts).
      const serves =
        configuration === "tokamak"
          ? coil.geometry.kind === "torus" &&
            torusWinding(coil) === "toroidal" &&
            torusEnclosesTorus(placementOf(coil), placementOf(vessel))
          : configuration === "linear" &&
            coil.geometry.kind === "cylinder" &&
            cylinderSurroundsCoaxially(placementOf(coil), placementOf(vessel));
      if (serves) {
        coilIds.push(coil.id);
        coilVessel.set(coil.id, vessel.id);
      }
    }
    const blanketIds: string[] = [];
    for (const blanket of analytic ? blankets : []) {
      if (blanketVessel.has(blanket.id)) continue;
      const encloses =
        configuration === "tokamak"
          ? torusEnclosesTorus(placementOf(blanket), placementOf(vessel))
          : configuration === "linear" &&
            blanket.geometry.kind === "cylinder" &&
            cylinderSurroundsCoaxially(placementOf(blanket), placementOf(vessel)) &&
            Math.abs(coaxialRelation(placementOf(blanket), placementOf(vessel)).axialOffsetM) <=
              0.1;
      if (encloses) {
        blanketIds.push(blanket.id);
        blanketVessel.set(blanket.id, vessel.id);
      }
    }
    // Pumps, injectors and heaters fitted to any segment serve the whole chamber.
    const linked = (type: ConnectionType, role: PlantRole) =>
      [
        ...new Set(
          chamber.memberIds.flatMap((m) =>
            neighbours(partial, type, m).filter((id) => byId.get(id)?.role === role),
          ),
        ),
      ].sort();
    return {
      vesselId: vessel.id,
      configuration,
      chamber,
      coilIds,
      blanketIds,
      heaterIds: linked("port", "plasma-heater"),
      injectorIds: linked("fuel", "fuel-injector"),
      pumpIds: linked("vacuum", "vacuum-pump"),
    };
  });

  return {
    byId,
    links,
    vessels,
    coilVessel,
    blanketVessel,
    orphanCoilIds: coils.filter((c) => !coilVessel.has(c.id)).map((c) => c.id),
    orphanBlanketIds: blankets.filter((b) => !blanketVessel.has(b.id)).map((b) => b.id),
  };
}

/** Connected groups of `ids` over links of the given types, each sorted, in id order. */
export function groupsOver(
  topology: PlantTopology,
  ids: readonly string[],
  types: readonly ConnectionType[],
  include: (link: PlantLink) => boolean = () => true,
): { groups: string[][]; linksByGroup: PlantLink[][] } {
  const members = new Set(ids);
  const adjacency = new Map<string, string[]>([...members].map((id) => [id, []]));
  const usable: PlantLink[] = [];
  for (const type of types) {
    for (const link of topology.links.get(type) ?? []) {
      if (!members.has(link.a) || !members.has(link.b) || !include(link)) continue;
      adjacency.get(link.a)!.push(link.b);
      adjacency.get(link.b)!.push(link.a);
      usable.push(link);
    }
  }
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const start of [...members].sort()) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const id = stack.pop()!;
      group.push(id);
      for (const next of adjacency.get(id)!) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    groups.push(group.sort());
  }
  const groupIndex = new Map<string, number>();
  groups.forEach((group, i) => group.forEach((id) => groupIndex.set(id, i)));
  const linksByGroup: PlantLink[][] = groups.map(() => []);
  for (const link of usable) linksByGroup[groupIndex.get(link.a)!]!.push(link);
  return { groups, linksByGroup };
}
