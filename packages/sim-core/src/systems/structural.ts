import { getMaterial } from "@forgelab/materials";
import {
  GEOMETRIC_EPSILON_M,
  type Meters,
  type Newtons,
  UP,
  type Vec3,
  Vec3Math,
  localDirectionToWorld,
  localPointToWorld,
  safeRatio,
} from "@forgelab/shared";
import {
  componentCenterOfMassM,
  currentTransform,
  type ComponentId,
  type ConnectionLoad,
  type SimulationComponent,
  type StructuralState,
  type SupportMode,
  type SupportState,
} from "../component.js";
import {
  type Connection,
  type ConnectionId,
  type ConnectionPoint,
  isLoadBearing,
} from "../connections.js";
import {
  classifyUtilization,
  describeConnectionOverload,
  describeYieldFailure,
  type FailureEvent,
} from "../failure.js";
import { loadBearingAreaM2, worldBottomY } from "../geometry.js";
import type { SimulationSettings } from "../settings.js";
import { gravitationalForceN } from "./gravity.js";

/**
 * Vertical separation below which a connection is treated as lateral rather than
 * load-bearing. Two sockets closer together than this in Y neither support nor load
 * each other in Phase 0.
 */
export const LATERAL_CONNECTION_EPSILON_M: Meters = 1e-3;

/**
 * Clamp applied to the horizontal lever arm when splitting a load between supports.
 * A support sitting exactly under the centre of mass would otherwise take an infinite
 * share; with this clamp it simply takes very nearly all of it.
 */
const MIN_LEVER_ARM_M: Meters = 1e-4;

/** Tolerance for deciding that a component is resting on the ground plane. */
export const GROUND_CONTACT_TOLERANCE_M: Meters = 1e-3;

/** A resolved, directed support relationship: `supportedId` rests on `supportId`. */
interface SupportEdge {
  readonly connectionId: ConnectionId;
  readonly supportedId: ComponentId;
  readonly supportId: ComponentId;
  /** World position of the socket on the supporting component. */
  readonly supportPointM: Vec3;
  readonly capacityN?: Newtons;
}

export interface StructuralSolveInput {
  readonly components: readonly SimulationComponent[];
  readonly connections: readonly Connection[];
  readonly settings: SimulationSettings;
  readonly simulatedTimeSec: number;
  readonly tick: number;
  /** Components already reported as failed, used by the `detach` propagation mode. */
  readonly previouslyFailedComponentIds?: ReadonlySet<ComponentId>;
}

export interface StructuralSolveResult {
  /** New support/structural state for every component, keyed by component id. */
  readonly states: ReadonlyMap<ComponentId, { support: SupportState; structural: StructuralState }>;
  /** Every failure detected this solve, in deterministic order. */
  readonly failures: readonly FailureEvent[];
  /** Non-fatal problems with the model itself (support cycles, missing sockets). */
  readonly diagnostics: readonly string[];
}

/**
 * ForgeLab's Phase 0 structural solver.
 *
 * WHAT IT DOES
 *   1. Works out what holds each component up: an anchor, the ground plane, or another
 *      component reached through a load-bearing connection.
 *   2. Accumulates weight down that support graph, topmost component first, so each
 *      member's total load is `own weight + everything resting on it`.
 *   3. Splits a member's load between its supports by the lever rule, generalised to any
 *      number of supports as inverse horizontal distance from the member's centre of mass.
 *      For the two-support case this reproduces the statics answer exactly.
 *   4. Turns each member's total load into an axial stress over its load-bearing section
 *      and compares that against the material's allowable stress.
 *
 * WHAT IT DOES NOT DO (documented approximations; see docs/ARCHITECTURE.md)
 *   - No bending, shear, torsion or buckling. Every member is treated as a short column
 *     in pure compression, so long slender spans read far stronger than they are.
 *   - No elastic compatibility. A statically indeterminate frame is resolved by the
 *     geometric lever rule above rather than by relative stiffness.
 *   - No horizontal equilibrium, no overturning check, and no dynamic amplification.
 *   - Connections that are purely lateral transfer no vertical load at all.
 *
 * It is deterministic: every collection is sorted by id before it is walked, so the same
 * input always produces the same output in the same order.
 */
export function solveStructure(input: StructuralSolveInput): StructuralSolveResult {
  const { settings } = input;
  const diagnostics: string[] = [];
  const failures: FailureEvent[] = [];

  const components = [...input.components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(components.map((c) => [c.id, c]));

  const detaching =
    settings.failurePropagation === "detach"
      ? (input.previouslyFailedComponentIds ?? new Set<ComponentId>())
      : new Set<ComponentId>();

  // --- 1. Own weight and ground contact ------------------------------------------------
  const ownWeightN = new Map<ComponentId, Newtons>();
  const rooted = new Set<ComponentId>();
  const groundedIds = new Set<ComponentId>();

  for (const component of components) {
    ownWeightN.set(component.id, gravitationalForceN(component.massKg, settings.gravityMps2));

    if (component.anchored) {
      rooted.add(component.id);
      continue;
    }
    if (settings.gravityMps2 <= 0) continue;

    const bottomY = worldBottomY(component.geometry, currentTransform(component));
    if (bottomY <= settings.groundLevelM + GROUND_CONTACT_TOLERANCE_M) {
      rooted.add(component.id);
      groundedIds.add(component.id);
    }
  }

  // --- 2. Orient load-bearing connections into support edges ---------------------------
  const edges: SupportEdge[] = [];
  const sortedConnections = [...input.connections].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  for (const connection of sortedConnections) {
    if (!isLoadBearing(connection.type)) continue;

    const a = byId.get(connection.from.componentId);
    const b = byId.get(connection.to.componentId);
    if (a === undefined || b === undefined) {
      diagnostics.push(`Connection "${connection.id}" references a component that is not present.`);
      continue;
    }

    const socketA = findSocket(a, connection.from.connectionPointId);
    const socketB = findSocket(b, connection.to.connectionPointId);
    if (socketA === undefined || socketB === undefined) {
      diagnostics.push(
        `Connection "${connection.id}" references a connection point that no longer exists.`,
      );
      continue;
    }

    const pointA = localPointToWorld(currentTransform(a), socketA.localPosition);
    const pointB = localPointToWorld(currentTransform(b), socketB.localPosition);
    const orientation = orientEdge(a, b, socketA, socketB, pointA, pointB);
    if (orientation === undefined) continue;

    const supportedIsA = orientation === "a-rests-on-b";
    // `detach` mode: a yielded member stops holding anything up from the next tick on.
    if (detaching.has(supportedIsA ? b.id : a.id)) continue;

    edges.push({
      connectionId: connection.id,
      supportedId: supportedIsA ? a.id : b.id,
      supportId: supportedIsA ? b.id : a.id,
      supportPointM: supportedIsA ? pointB : pointA,
      ...resolveCapacity(connection, socketA, socketB),
    });
  }

  const edgesBySupported = groupBy(edges, (e) => e.supportedId);
  const edgesBySupport = groupBy(edges, (e) => e.supportId);

  // --- 3. Propagate "is held up" outward from anchors and the ground --------------------
  const supportedIds = new Set<ComponentId>(rooted);
  const queue = [...rooted].sort();
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edgesBySupport.get(current) ?? []) {
      if (supportedIds.has(edge.supportedId)) continue;
      supportedIds.add(edge.supportedId);
      queue.push(edge.supportedId);
    }
  }

  // --- 4. Accumulate load, topmost component first --------------------------------------
  const order = topologicalOrder(components, edgesBySupported, diagnostics);
  const carriedLoadN = new Map<ComponentId, Newtons>(components.map((c) => [c.id, 0]));
  const reactionsBySupported = new Map<ComponentId, ConnectionLoad[]>();
  const loadPath = new Map<ComponentId, ComponentId[]>();

  for (const id of order) {
    const component = byId.get(id)!;
    const carried = carriedLoadN.get(id) ?? 0;
    const own = ownWeightN.get(id) ?? 0;
    const total = carried + own;

    const outgoing = (edgesBySupported.get(id) ?? []).filter((e) => supportedIds.has(e.supportId));
    // Anchors and anything on the ground shed their load straight into the ground.
    if (outgoing.length === 0 || rooted.has(id)) continue;

    const comM = componentCenterOfMassM(component);
    const shares = leverRuleShares(comM, outgoing);
    const reactions: ConnectionLoad[] = [];

    for (let i = 0; i < outgoing.length; i += 1) {
      const edge = outgoing[i]!;
      const loadN = total * shares[i]!;
      carriedLoadN.set(edge.supportId, (carriedLoadN.get(edge.supportId) ?? 0) + loadN);

      const path = [id, ...(loadPath.get(id) ?? [])];
      const existing = loadPath.get(edge.supportId) ?? [];
      loadPath.set(edge.supportId, dedupe([...existing, ...path]));

      reactions.push({
        connectionId: edge.connectionId,
        otherComponentId: edge.supportId,
        loadN,
        ...(edge.capacityN === undefined ? {} : { capacityN: edge.capacityN }),
      });
    }

    reactions.sort((x, y) => (x.connectionId < y.connectionId ? -1 : 1));
    reactionsBySupported.set(id, reactions);
  }

  // --- 5. Per-component stress and per-connection capacity ------------------------------
  const states = new Map<ComponentId, { support: SupportState; structural: StructuralState }>();

  for (const component of components) {
    const id = component.id;
    const own = ownWeightN.get(id) ?? 0;
    const carried = carriedLoadN.get(id) ?? 0;
    const total = carried + own;
    const reactions = reactionsBySupported.get(id) ?? [];

    const mode = supportModeFor(component, id, rooted, groundedIds, supportedIds);
    const support: SupportState = Object.freeze({
      mode,
      supportedByComponentIds: Object.freeze(
        (edgesBySupported.get(id) ?? []).map((e) => e.supportId).sort(),
      ),
      supportingComponentIds: Object.freeze(
        (edgesBySupport.get(id) ?? []).map((e) => e.supportedId).sort(),
      ),
      ownWeightN: own,
      carriedLoadN: carried,
      totalLoadN: total,
      reactions: Object.freeze(reactions),
    });

    const material = getMaterial(component.materialId);
    const areaM2 = loadBearingAreaM2(component.geometry, component.state.physical.rotation);
    const allowableStressPa = material.yieldStrengthPa / settings.designSafetyFactor;
    // A component in free fall is not being loaded by anything: no contact, no stress.
    const appliedStressPa = mode === "free" ? 0 : safeRatio(total, areaM2);
    const utilization = safeRatio(appliedStressPa, allowableStressPa);
    const status = classifyUtilization(utilization);

    const structural: StructuralState = Object.freeze({
      loadBearingAreaM2: areaM2,
      appliedStressPa,
      allowableStressPa,
      utilization,
      status,
      failed: status === "failed",
    });

    states.set(id, { support, structural });

    if (status === "failed") {
      failures.push(
        Object.freeze({
          timestampSec: input.simulatedTimeSec,
          tick: input.tick,
          componentId: id,
          system: "structural",
          failureType: "yield_exceeded",
          unit: "Pa",
          measuredValue: appliedStressPa,
          limitValue: allowableStressPa,
          utilization,
          loadPathComponentIds: Object.freeze(loadPath.get(id) ?? []),
          cause: describeYieldFailure({
            componentId: id,
            componentType: component.type,
            materialName: material.name,
            totalLoadN: total,
            ownWeightN: own,
            carriedLoadN: carried,
            areaM2,
            appliedStressPa,
            allowableStressPa,
            yieldStrengthPa: material.yieldStrengthPa,
            designSafetyFactor: settings.designSafetyFactor,
            supportedComponentIds: support.supportingComponentIds,
          }),
        }),
      );
    }
  }

  for (const edge of edges) {
    if (edge.capacityN === undefined) continue;
    const reactions = reactionsBySupported.get(edge.supportedId) ?? [];
    const reaction = reactions.find((r) => r.connectionId === edge.connectionId);
    if (reaction === undefined || reaction.loadN <= edge.capacityN) continue;

    failures.push(
      Object.freeze({
        timestampSec: input.simulatedTimeSec,
        tick: input.tick,
        componentId: edge.supportedId,
        connectionId: edge.connectionId,
        system: "structural",
        failureType: "connection_overload",
        unit: "N",
        measuredValue: reaction.loadN,
        limitValue: edge.capacityN,
        utilization: safeRatio(reaction.loadN, edge.capacityN),
        loadPathComponentIds: Object.freeze(
          dedupe([edge.supportedId, ...(loadPath.get(edge.supportedId) ?? [])]),
        ),
        cause: describeConnectionOverload({
          connectionId: edge.connectionId,
          supportedComponentId: edge.supportedId,
          supportingComponentId: edge.supportId,
          transferredLoadN: reaction.loadN,
          capacityN: edge.capacityN,
          loadPathComponentIds: dedupe([
            edge.supportedId,
            ...(loadPath.get(edge.supportedId) ?? []),
          ]),
        }),
      }),
    );
  }

  failures.sort(compareFailures);

  return { states, failures, diagnostics };
}

function supportModeFor(
  component: SimulationComponent,
  id: ComponentId,
  rooted: ReadonlySet<ComponentId>,
  grounded: ReadonlySet<ComponentId>,
  supported: ReadonlySet<ComponentId>,
): SupportMode {
  if (component.anchored) return "anchored";
  if (grounded.has(id)) return "grounded";
  if (rooted.has(id)) return "anchored";
  return supported.has(id) ? "supported" : "free";
}

function findSocket(
  component: SimulationComponent,
  connectionPointId: string,
): ConnectionPoint | undefined {
  return component.connectionPoints.find((point) => point.id === connectionPointId);
}

function resolveCapacity(
  connection: Connection,
  socketA: ConnectionPoint,
  socketB: ConnectionPoint,
): { capacityN?: Newtons } {
  const candidates = [connection.maxLoadN, socketA.maxLoadN, socketB.maxLoadN].filter(
    (value): value is Newtons => value !== undefined,
  );
  if (candidates.length === 0) return {};
  return { capacityN: Math.min(...candidates) };
}

/**
 * Decides which end of a connection holds the other up.
 *
 * The socket normals answer this directly: a socket on the underside of a part points
 * down, so the part it belongs to is the one being held. When neither normal is clearly
 * vertical we fall back to which socket sits higher. Sockets at the same height with no
 * vertical normal are a lateral tie and carry no vertical load in Phase 0.
 */
function orientEdge(
  a: SimulationComponent,
  b: SimulationComponent,
  socketA: ConnectionPoint,
  socketB: ConnectionPoint,
  pointA: Vec3,
  pointB: Vec3,
): "a-rests-on-b" | "b-rests-on-a" | undefined {
  const dirA = Vec3Math.dot(localDirectionToWorld(currentTransform(a), socketA.localDirection), UP);
  const dirB = Vec3Math.dot(localDirectionToWorld(currentTransform(b), socketB.localDirection), UP);

  const aFacesDown = dirA < -0.5;
  const bFacesDown = dirB < -0.5;
  if (aFacesDown && !bFacesDown) return "a-rests-on-b";
  if (bFacesDown && !aFacesDown) return "b-rests-on-a";

  const dy = pointA.y - pointB.y;
  if (dy > LATERAL_CONNECTION_EPSILON_M) return "a-rests-on-b";
  if (dy < -LATERAL_CONNECTION_EPSILON_M) return "b-rests-on-a";
  return undefined;
}

/**
 * Splits a load between supports by the lever rule.
 *
 * Each support's share is proportional to the reciprocal of its horizontal distance from
 * the supported component's centre of mass. For two supports this is exactly the statics
 * result (R1 = W*b/L, R2 = W*a/L); for more it is a documented generalisation that keeps
 * load where the mass is and always sums to 1.
 */
function leverRuleShares(centerOfMassM: Vec3, edges: readonly SupportEdge[]): number[] {
  if (edges.length === 1) return [1];

  const weights = edges.map((edge) => {
    const dx = edge.supportPointM.x - centerOfMassM.x;
    const dz = edge.supportPointM.z - centerOfMassM.z;
    const leverArm = Math.max(Math.hypot(dx, dz), MIN_LEVER_ARM_M);
    return 1 / leverArm;
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return edges.map(() => 1 / edges.length);
  return weights.map((w) => w / total);
}

/**
 * Orders components so that everything resting on a component is processed before the
 * component itself. Kahn's algorithm over the support graph, with ids as the tie-break so
 * the order is reproducible. Support graphs are acyclic by construction (edges only ever
 * point downward), but a cycle is broken deterministically rather than hanging the solver.
 */
function topologicalOrder(
  components: readonly SimulationComponent[],
  edgesBySupported: ReadonlyMap<ComponentId, readonly SupportEdge[]>,
  diagnostics: string[],
): ComponentId[] {
  const inDegree = new Map<ComponentId, number>(components.map((c) => [c.id, 0]));
  for (const [, edges] of edgesBySupported) {
    for (const edge of edges) {
      inDegree.set(edge.supportId, (inDegree.get(edge.supportId) ?? 0) + 1);
    }
  }

  const ready = components
    .filter((c) => (inDegree.get(c.id) ?? 0) === 0)
    .map((c) => c.id)
    .sort();
  const order: ComponentId[] = [];
  const remaining = new Set(components.map((c) => c.id));

  while (remaining.size > 0) {
    if (ready.length === 0) {
      const next = [...remaining].sort()[0]!;
      diagnostics.push(
        `Support cycle detected; broke it deterministically at component "${next}". ` +
          `Load results around that cycle are approximate.`,
      );
      ready.push(next);
    }

    ready.sort();
    const id = ready.shift()!;
    if (!remaining.has(id)) continue;
    remaining.delete(id);
    order.push(id);

    for (const edge of edgesBySupported.get(id) ?? []) {
      const degree = (inDegree.get(edge.supportId) ?? 0) - 1;
      inDegree.set(edge.supportId, degree);
      if (degree <= 0 && remaining.has(edge.supportId) && !ready.includes(edge.supportId)) {
        ready.push(edge.supportId);
      }
    }
  }

  return order;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket === undefined) map.set(k, [item]);
    else bucket.push(item);
  }
  return map;
}

function dedupe(ids: readonly ComponentId[]): ComponentId[] {
  return [...new Set(ids)];
}

function compareFailures(a: FailureEvent, b: FailureEvent): number {
  if (a.componentId !== b.componentId) return a.componentId < b.componentId ? -1 : 1;
  if (a.failureType !== b.failureType) return a.failureType < b.failureType ? -1 : 1;
  return (a.connectionId ?? "") < (b.connectionId ?? "") ? -1 : 1;
}

export const STRUCTURAL_SOLVER_CONSTANTS = Object.freeze({
  LATERAL_CONNECTION_EPSILON_M,
  GROUND_CONTACT_TOLERANCE_M,
  MIN_LEVER_ARM_M,
  GEOMETRIC_EPSILON_M,
});
