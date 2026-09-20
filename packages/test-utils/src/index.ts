import { MaterialIds, type MaterialId } from "@forgelab/materials";
import { QUATERNION_IDENTITY, type Transform, type Vec3, transform, vec3 } from "@forgelab/shared";
import {
  type ComponentGeometry,
  type SimulationComponent,
  type SimulationSettings,
  type SimulationSnapshot,
  SimulationWorld,
  boxGeometry,
  connectionPoint,
} from "@forgelab/sim-core";
import { COMPONENT_DEFINITIONS, getComponentDefinition } from "@forgelab/reactor-components";

/** Places a component from the built-in catalogue at a world position. */
export function place(
  world: SimulationWorld,
  type: string,
  options: {
    id?: string;
    positionM?: Vec3;
    transform?: Transform;
    materialId?: MaterialId;
    anchored?: boolean;
    additionalMassKg?: number;
  } = {},
): SimulationComponent {
  const definition = getComponentDefinition(type);
  const placement =
    options.transform ?? transform(options.positionM ?? vec3(0, 0, 0), QUATERNION_IDENTITY);

  return world.addComponent(
    definition.createSpec({
      id: options.id ?? world.nextId(type),
      transform: placement,
      ...(options.materialId === undefined ? {} : { materialId: options.materialId }),
      ...(options.anchored === undefined ? {} : { anchored: options.anchored }),
      ...(options.additionalMassKg === undefined
        ? {}
        : { additionalMassKg: options.additionalMassKg }),
    }),
  );
}

/**
 * A bare box component with a bottom and a top socket.
 *
 * Used where a test is about the solver rather than about a catalogue part, so that the
 * numbers under test stay easy to work out by hand.
 */
export function placeBlock(
  world: SimulationWorld,
  options: {
    id: string;
    positionM?: Vec3;
    sizeM?: Vec3;
    materialId?: MaterialId;
    anchored?: boolean;
    additionalMassKg?: number;
    maxLoadN?: number;
    geometry?: ComponentGeometry;
  },
): SimulationComponent {
  const geometry = options.geometry ?? boxGeometry(options.sizeM ?? vec3(1, 1, 1));
  const half = (options.sizeM ?? vec3(1, 1, 1)).y / 2;

  return world.addComponent({
    id: options.id,
    type: "test-block",
    geometry,
    materialId: options.materialId ?? MaterialIds.StructuralSteel,
    transform: transform(options.positionM ?? vec3(0, 0, 0), QUATERNION_IDENTITY),
    connectionPoints: [
      connectionPoint("bottom", vec3(0, -half, 0), vec3(0, -1, 0), "structural", options.maxLoadN),
      connectionPoint("top", vec3(0, half, 0), vec3(0, 1, 0), "structural", options.maxLoadN),
    ],
    ...(options.anchored === undefined ? {} : { anchored: options.anchored }),
    ...(options.additionalMassKg === undefined
      ? {}
      : { additionalMassKg: options.additionalMassKg }),
  });
}

/** Stacks `upper` on `lower` via their top/bottom sockets. */
export function stack(
  world: SimulationWorld,
  lowerId: string,
  upperId: string,
  options: { maxLoadN?: number; id?: string } = {},
) {
  return world.connect(
    { componentId: upperId, connectionPointId: "bottom" },
    { componentId: lowerId, connectionPointId: "top" },
    {
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.maxLoadN === undefined ? {} : { maxLoadN: options.maxLoadN }),
    },
  );
}

export function makeWorld(settings: Partial<SimulationSettings> = {}): SimulationWorld {
  return new SimulationWorld({ name: "Test Assembly", settings });
}

/**
 * A canonical, fully deterministic fingerprint of everything the simulation decides.
 *
 * Used by the determinism and frame-rate tests: two runs are identical if and only if
 * their fingerprints match, with no dependence on object identity or key order.
 */
export function fingerprintSnapshot(snapshot: SimulationSnapshot): string {
  const components = snapshot.components.map((component) => ({
    id: component.id,
    massKg: component.massKg,
    position: round(component.state.physical.positionM),
    rotation: [
      r(component.state.physical.rotation.x),
      r(component.state.physical.rotation.y),
      r(component.state.physical.rotation.z),
      r(component.state.physical.rotation.w),
    ],
    linear: round(component.state.physical.linearVelocityMps),
    angular: round(component.state.physical.angularVelocityRadPerSec),
    mode: component.state.support.mode,
    ownWeightN: r(component.state.support.ownWeightN),
    carriedLoadN: r(component.state.support.carriedLoadN),
    totalLoadN: r(component.state.support.totalLoadN),
    reactions: component.state.support.reactions.map((reaction) => [
      reaction.connectionId,
      r(reaction.loadN),
    ]),
    appliedStressPa: r(component.state.structural.appliedStressPa),
    utilization: r(component.state.structural.utilization),
    status: component.state.structural.status,
  }));

  return JSON.stringify({
    tick: snapshot.tick,
    simulatedTimeSec: r(snapshot.simulatedTimeSec),
    components,
    totalMassKg: r(snapshot.assembly.totalMassKg),
    centerOfMassM: round(snapshot.assembly.centerOfMassM),
    failures: snapshot.failures.map((failure) => [
      failure.componentId,
      failure.failureType,
      failure.tick,
      r(failure.measuredValue),
      r(failure.limitValue),
      failure.cause,
    ]),
  });
}

/** Rounds to 12 significant figures: far tighter than any physical tolerance we claim. */
const r = (value: number): number => Number(value.toPrecision(12));
const round = (v: Vec3): [number, number, number] => [r(v.x), r(v.y), r(v.z)];

/** Every component type in the shipped catalogue, for coverage-style tests. */
export const ALL_COMPONENT_TYPES: readonly string[] = COMPONENT_DEFINITIONS.map((d) => d.type);
