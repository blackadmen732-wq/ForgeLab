import {
  QuaternionMath,
  Vec3Math,
  localPointToWorld,
  transform,
  vec3,
  type Transform,
} from "@forgelab/shared";
import { currentTransform, type SimulationComponent } from "./component.js";
import { type Connection, type ConnectionEndpoint, type ConnectionPoint } from "./connections.js";
import { boxGeometry } from "./geometry.js";
import { resolveParameters } from "./plant/roles.js";
import { checkPortCompatibility } from "./ports.js";

/** Stock modules supported by the existing lumped pump model. Dimensions/offsets are SI.
 * This is a model capability, not a second catalogue or a subcomponent performance solver.
 */
export const PUMP_CONSTRUCTION_RECIPE = {
  id: "coolant-pump-kit-v1",
  name: "Modular Coolant Pump",
  resultType: "coolant-pump",
  parts: [
    {
      key: "base",
      type: "pump-base",
      name: "Base / skid",
      offset: vec3(0, -0.875, 0),
      size: vec3(1.85, 0.25, 1.78),
    },
    {
      key: "casing",
      type: "pump-casing",
      name: "Pump casing",
      offset: vec3(0, -0.15, 0),
      size: vec3(2, 1.36, 1.3),
    },
    {
      key: "drive",
      type: "pump-drive-module",
      name: "Drive / coupling",
      offset: vec3(0, -0.1, 0),
      size: vec3(0.5, 0.3, 0.5),
    },
    {
      key: "motor",
      type: "pump-motor",
      name: "Motor / terminals",
      offset: vec3(0, 0.5, 0),
      size: vec3(1, 1, 2),
    },
  ],
  joints: [
    { from: ["base", "casing-seat"], to: ["casing", "base"] },
    { from: ["casing", "drive-seat"], to: ["drive", "casing-mate"] },
    { from: ["drive", "motor-seat"], to: ["motor", "base"] },
  ],
  externalPorts: {
    base: ["base", "base"],
    inlet: ["casing", "inlet"],
    outlet: ["casing", "outlet"],
    power: ["motor", "power"],
    control: ["motor", "control"],
  },
} as const;
export type PumpPartKey = (typeof PUMP_CONSTRUCTION_RECIPE.parts)[number]["key"];
/** Authored membership only. Completion is always recomputed, never trusted from a save. */
export interface BuildAssembly {
  readonly id: string;
  readonly recipeId: string;
  readonly partIds: Readonly<Record<string, string>>;
}
export interface ConstructionStatus {
  readonly assembly: BuildAssembly;
  readonly name: string;
  readonly state: "complete" | "incomplete" | "unsupported";
  readonly issues: readonly string[];
  readonly externalPorts: Readonly<Record<string, ConnectionEndpoint>>;
}
const recipe = PUMP_CONSTRUCTION_RECIPE;
export const pumpPart = (type: string) => recipe.parts.find((p) => p.type === type);
const endpointKey = (e: ConnectionEndpoint) => `${e.componentId}/${e.connectionPointId}`;
const point = (c: SimulationComponent, id: string) => c.connectionPoints.find((p) => p.id === id);

/** Only these pairs are recognized construction mates. Ordinary structure stays unrestricted. */
export function isConstructionMate(
  a: SimulationComponent,
  pa: ConnectionPoint,
  b: SimulationComponent,
  pb: ConnectionPoint,
): boolean {
  const ka = pumpPart(a.type)?.key,
    kb = pumpPart(b.type)?.key;
  return recipe.joints.some(
    (j) =>
      (j.from[0] === ka && j.from[1] === pa.id && j.to[0] === kb && j.to[1] === pb.id) ||
      (j.to[0] === ka && j.to[1] === pa.id && j.from[0] === kb && j.from[1] === pb.id),
  );
}

/** Keyed stock modules share a frame; match that frame and the actual socket position. */
export function constructionMateTransform(
  a: SimulationComponent,
  pa: ConnectionPoint,
  b: SimulationComponent,
  pb: ConnectionPoint,
): Transform | null {
  if (!isConstructionMate(a, pa, b, pb) || !checkPortCompatibility(pa, pb).compatible) return null;
  const t = currentTransform(b);
  return transform(
    Vec3Math.subtract(
      localPointToWorld(t, pb.localPosition),
      QuaternionMath.rotateVec3(t.rotation, pa.localPosition),
    ),
    t.rotation,
  );
}

export function inspectConstruction(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
  assemblies: readonly BuildAssembly[],
): readonly ConstructionStatus[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const ownership = new Map<string, number>();
  for (const a of assemblies)
    for (const id of Object.values(a.partIds)) ownership.set(id, (ownership.get(id) ?? 0) + 1);
  return assemblies.map((assembly) => {
    const issues: string[] = [];
    const externalPorts: Record<string, ConnectionEndpoint> = {};
    if (assembly.recipeId !== recipe.id)
      return {
        assembly,
        name: "Unsupported assembly",
        state: "unsupported" as const,
        issues: ["This construction recipe has no supported physical model."],
        externalPorts,
      };
    let unsupported = Object.keys(assembly.partIds).some(
      (key) => !recipe.parts.some((p) => p.key === key),
    );
    if (unsupported) issues.push("This recipe contains unsupported module slots.");
    const members = new Set(Object.values(assembly.partIds));
    for (const link of connections) {
      if (
        link.type !== "mount" ||
        members.has(link.from.componentId) === members.has(link.to.componentId)
      )
        continue;
      const a = byId.get(link.from.componentId),
        b = byId.get(link.to.componentId);
      const pa = a && point(a, link.from.connectionPointId),
        pb = b && point(b, link.to.connectionPointId);
      if (a && b && pa && pb && isConstructionMate(a, pa, b, pb)) {
        unsupported = true;
        issues.push(
          "Extra construction modules share this machine; this combination is unsupported.",
        );
      }
    }
    const base = byId.get(assembly.partIds["base"] ?? "");
    const frame = base && currentTransform(base);
    for (const p of recipe.parts) {
      const c = byId.get(assembly.partIds[p.key] ?? "");
      if (!c) {
        issues.push(`Missing ${p.name.toLowerCase()}.`);
        continue;
      }
      if (
        c.type !== p.type ||
        c.role !== "structure" ||
        c.materialId !== "stainless-steel" ||
        c.composition.length > 0 ||
        c.geometry.kind !== "box" ||
        Vec3Math.distance(c.geometry.sizeM, p.size) > 1e-8
      ) {
        unsupported = true;
        issues.push(`${p.name}: this module variant is not supported by the stock pump model.`);
      }
      if (
        p.key === "casing" &&
        ["inlet", "outlet"].some((id) => {
          const port = point(c, id)?.port;
          return (
            port?.domain !== "fluid" ||
            port.fluid !== "pressurized-water" ||
            Math.abs(port.innerDiameterM - 0.66) > 1e-8
          );
        })
      ) {
        unsupported = true;
        issues.push("This casing fluid/bore variant is outside the stock pump recipe.");
      }
      if ((ownership.get(c.id) ?? 0) > 1) {
        unsupported = true;
        issues.push(`${p.name} belongs to multiple construction assemblies.`);
      }
      if (frame) {
        const expected = localPointToWorld(
          frame,
          Vec3Math.subtract(p.offset, recipe.parts[0].offset),
        );
        const t = currentTransform(c);
        const q = t.rotation,
          r = frame.rotation;
        if (
          Vec3Math.distance(t.positionM, expected) > 0.002 ||
          Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w) < 1 - 1e-6
        )
          issues.push(`${p.name} is not seated in the assembly.`);
      }
      if (c.state.structural.failed) issues.push(`${p.name} has failed structurally.`);
    }
    for (const j of recipe.joints) {
      const a = byId.get(assembly.partIds[j.from[0]] ?? ""),
        b = byId.get(assembly.partIds[j.to[0]] ?? "");
      const pa = a && point(a, j.from[1]),
        pb = b && point(b, j.to[1]);
      const from = { componentId: a?.id ?? "", connectionPointId: j.from[1] },
        to = { componentId: b?.id ?? "", connectionPointId: j.to[1] };
      const linked = connections.some(
        (c) =>
          c.type === "mount" &&
          ((endpointKey(c.from) === endpointKey(from) && endpointKey(c.to) === endpointKey(to)) ||
            (endpointKey(c.to) === endpointKey(from) && endpointKey(c.from) === endpointKey(to))),
      );
      if (!pa || !pb || !linked || !checkPortCompatibility(pa, pb).compatible)
        issues.push(`Attach ${j.from[0]} → ${j.to[0]}.`);
    }
    for (const [name, [key, socketId]] of Object.entries(recipe.externalPorts)) {
      const c = byId.get(assembly.partIds[key] ?? "");
      if (c && point(c, socketId))
        externalPorts[name] = { componentId: c.id, connectionPointId: socketId };
      else issues.push(`Missing ${name} interface.`);
    }
    return {
      assembly,
      name: recipe.name,
      state: unsupported
        ? ("unsupported" as const)
        : issues.length
          ? ("incomplete" as const)
          : ("complete" as const),
      issues,
      externalPorts,
    };
  });
}

/** Plant-only condensation. The structural solver retains the real parts and their mass
 * exactly once. External links still belong to their authored casing/motor/base ports.
 * A complete stock construction uses ONE unchanged, lumped-temperature coolant-pump model.
 */
export function resolveConstruction(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
  assemblies: readonly BuildAssembly[],
) {
  // Construction module types never become independent pumps through a forged role.
  // Their supported active behaviour exists only after core recognizes the complete kit.
  const passiveComponents = components.some((c) => pumpPart(c.type) && c.role !== "structure")
    ? components.map((c) =>
        pumpPart(c.type)
          ? { ...c, role: "structure" as const, parameters: resolveParameters("structure", {}) }
          : c,
      )
    : components;
  if (assemblies.length === 0)
    return {
      components: passiveComponents,
      connections,
      aliases: new Map<string, string>(),
      statuses: [] as readonly ConstructionStatus[],
    };
  const statuses = inspectConstruction(components, connections, assemblies);
  const aliases = new Map<string, string>();
  const endpoints = new Map<string, ConnectionEndpoint>();
  const replacements = new Map<string, SimulationComponent>();
  const byId = new Map(components.map((c) => [c.id, c]));
  for (const status of statuses) {
    if (status.state !== "complete") continue;
    const ids = status.assembly.partIds;
    const casing = byId.get(ids["casing"]!)!;
    const base = byId.get(ids["base"]!)!;
    const frame = currentTransform(base);
    const origin = localPointToWorld(frame, Vec3Math.scale(recipe.parts[0].offset, -1));
    const pose = transform(origin, frame.rotation);
    const massKg = recipe.parts.reduce((sum, part) => sum + byId.get(ids[part.key]!)!.massKg, 0);
    const points: ConnectionPoint[] = [];
    for (const [name, e] of Object.entries(status.externalPorts)) {
      const c = byId.get(e.componentId)!;
      const p = point(c, e.connectionPointId)!;
      const t = currentTransform(c);
      points.push({
        ...p,
        id: name,
        localPosition: QuaternionMath.inverseRotateVec3(
          frame.rotation,
          Vec3Math.subtract(localPointToWorld(t, p.localPosition), origin),
        ),
        localDirection: QuaternionMath.inverseRotateVec3(
          frame.rotation,
          QuaternionMath.rotateVec3(t.rotation, p.localDirection),
        ),
      });
      endpoints.set(endpointKey(e), { componentId: casing.id, connectionPointId: name });
    }
    const model: SimulationComponent = {
      ...casing,
      type: recipe.resultType,
      label: recipe.name,
      role: "coolant-pump",
      geometry: boxGeometry(vec3(2, 2, 2), 0.04),
      parameters: resolveParameters("coolant-pump", { ratedMassFlowKgS: 4000, ratedHeadM: 120 }),
      transform: pose,
      connectionPoints: points,
      massKg,
      composition: [],
      additionalMassKg: 0,
      state: {
        ...casing.state,
        physical: { ...casing.state.physical, massKg, positionM: origin, rotation: frame.rotation },
      },
    };
    replacements.set(casing.id, model);
    for (const id of Object.values(ids)) aliases.set(id, casing.id);
  }
  const projectedComponents = passiveComponents
    .filter((c) => !aliases.has(c.id) || replacements.has(c.id))
    .map((c) => replacements.get(c.id) ?? c);
  const mapped = connections.flatMap((c) => {
    const from = endpoints.get(endpointKey(c.from)) ?? c.from;
    const to = endpoints.get(endpointKey(c.to)) ?? c.to;
    // Internal assembly joints are already enforced by construction, and do not become hoses.
    if (
      (aliases.has(c.from.componentId) && !endpoints.has(endpointKey(c.from))) ||
      (aliases.has(c.to.componentId) && !endpoints.has(endpointKey(c.to))) ||
      from.componentId === to.componentId
    )
      return [];
    return [{ ...c, from, to }];
  });
  return { components: projectedComponents, connections: mapped, aliases, statuses };
}
