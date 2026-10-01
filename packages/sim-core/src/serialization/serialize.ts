import { QUATERNION_IDENTITY, quaternion, transform, vec3, Vec3Math } from "@forgelab/shared";
import type { PhysicalProperties, SimulationComponent } from "../component.js";
import type { Connection, ConnectionPoint, ConnectionType } from "../connections.js";
import { CONNECTION_TYPES } from "../connections.js";
import { compositionError } from "../component.js";
import { parsePortSpec, type PortSpec } from "../ports.js";
import {
  boxGeometry,
  arcGeometry,
  cylinderGeometry,
  torusGeometry,
  type ComponentGeometry,
} from "../geometry.js";
import { isPlantRole, resolveParameters } from "../plant/roles.js";
import { makeSettings, type SimulationSettings } from "../settings.js";
import { SimulationWorld, type WorldOptions } from "../world.js";
import {
  CURRENT_SCHEMA_VERSION,
  type AssemblyFileV1,
  type SerializedComponent,
  type SerializedMaterialRegion,
  type SerializedConnection,
  type SerializedConnectionPoint,
  type SerializedGeometry,
  type SerializedPhysicalState,
  type SerializedQuaternion,
  type SerializedSimulationSettings,
  type SerializedTransform,
  type SerializedVec3,
} from "./schema.js";

export class AssemblyFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyFileError";
  }
}

/* ------------------------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------------------------ */

export interface SerializeOptions {
  /** Stamped into `meta` for provenance. Never read back. */
  readonly savedAtIso?: string;
  readonly generator?: string;
}

export function serializeWorld(
  world: SimulationWorld,
  options: SerializeOptions = {},
): AssemblyFileV1 {
  const meta =
    options.savedAtIso === undefined && options.generator === undefined
      ? undefined
      : {
          ...(options.generator === undefined ? {} : { generator: options.generator }),
          ...(options.savedAtIso === undefined ? {} : { savedAtIso: options.savedAtIso }),
        };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: world.name,
    components: world.listComponents().map(serializeComponent),
    connections: world.listConnections().map(serializeConnection),
    simulationSettings: serializeSettings(world.settings),
    runtime: {
      tick: world.tick,
      simulatedTimeSec: world.simulatedTimeSec,
      idCounter: world.idCounter,
    },
    ...(meta === undefined ? {} : { meta }),
  };
}

export function serializeComponent(component: SimulationComponent): SerializedComponent {
  const physical = component.state.physical;
  const movedFromAuthoredPlacement =
    !Vec3Math.equals(physical.positionM, component.transform.positionM) ||
    !Vec3Math.equals(physical.linearVelocityMps, Vec3Math.VEC3_ZERO) ||
    !Vec3Math.equals(physical.angularVelocityRadPerSec, Vec3Math.VEC3_ZERO) ||
    !quaternionEquals(physical.rotation, component.transform.rotation);

  return {
    id: component.id,
    type: component.type,
    label: component.label,
    materialId: component.materialId,
    geometry: serializeGeometry(component.geometry),
    transform: serializeTransform(component.transform),
    connectionPoints: component.connectionPoints.map(serializeConnectionPoint),
    additionalMassKg: component.additionalMassKg,
    anchored: component.anchored,
    ...(movedFromAuthoredPlacement ? { physical: serializePhysical(physical) } : {}),
    role: component.role,
    parameters: { ...component.parameters },
    ...(component.composition.length === 0
      ? {}
      : { composition: component.composition.map((r) => ({ ...r })) }),
  };
}

const serializeVec3 = (v: { x: number; y: number; z: number }): SerializedVec3 => ({
  x: v.x,
  y: v.y,
  z: v.z,
});

const serializeQuaternion = (q: {
  x: number;
  y: number;
  z: number;
  w: number;
}): SerializedQuaternion => ({ x: q.x, y: q.y, z: q.z, w: q.w });

const serializeTransform = (t: {
  positionM: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}): SerializedTransform => ({
  positionM: serializeVec3(t.positionM),
  rotation: serializeQuaternion(t.rotation),
});

const serializePhysical = (p: PhysicalProperties): SerializedPhysicalState => ({
  positionM: serializeVec3(p.positionM),
  rotation: serializeQuaternion(p.rotation),
  linearVelocityMps: serializeVec3(p.linearVelocityMps),
  angularVelocityRadPerSec: serializeVec3(p.angularVelocityRadPerSec),
});

function serializeGeometry(geometry: ComponentGeometry): SerializedGeometry {
  if (geometry.kind === "box") {
    return {
      kind: "box",
      sizeM: serializeVec3(geometry.sizeM),
      ...(geometry.wallThicknessM === undefined ? {} : { wallThicknessM: geometry.wallThicknessM }),
    };
  }
  if (geometry.kind === "arc") {
    return {
      kind: "arc",
      bendRadiusM: geometry.bendRadiusM,
      sweepRad: geometry.sweepRad,
      radiusM: geometry.radiusM,
      axis: geometry.axis,
      ...(geometry.wallThicknessM === undefined ? {} : { wallThicknessM: geometry.wallThicknessM }),
    };
  }
  if (geometry.kind === "torus") {
    return {
      kind: "torus",
      majorRadiusM: geometry.majorRadiusM,
      minorRadiusM: geometry.minorRadiusM,
      axis: geometry.axis,
      ...(geometry.wallThicknessM === undefined ? {} : { wallThicknessM: geometry.wallThicknessM }),
    };
  }
  return {
    kind: "cylinder",
    radiusM: geometry.radiusM,
    heightM: geometry.heightM,
    axis: geometry.axis,
    ...(geometry.wallThicknessM === undefined ? {} : { wallThicknessM: geometry.wallThicknessM }),
  };
}

function serializeConnectionPoint(point: ConnectionPoint): SerializedConnectionPoint {
  return {
    id: point.id,
    localPosition: serializeVec3(point.localPosition),
    localDirection: serializeVec3(point.localDirection),
    connectionType: point.connectionType,
    ...(point.maxLoadN === undefined ? {} : { maxLoadN: point.maxLoadN }),
    ...(point.port === undefined ? {} : { port: { ...point.port } }),
  };
}

function serializeConnection(connection: Connection): SerializedConnection {
  return {
    id: connection.id,
    type: connection.type,
    from: { ...connection.from },
    to: { ...connection.to },
    ...(connection.maxLoadN === undefined ? {} : { maxLoadN: connection.maxLoadN }),
  };
}

function serializeSettings(settings: SimulationSettings): SerializedSimulationSettings {
  return {
    gravityMps2: settings.gravityMps2,
    fixedTimestepSec: settings.fixedTimestepSec,
    groundLevelM: settings.groundLevelM,
    designSafetyFactor: settings.designSafetyFactor,
    failurePropagation: settings.failurePropagation,
    maxFailureLogEntries: settings.maxFailureLogEntries,
    bucklingEffectiveLengthFactor: settings.bucklingEffectiveLengthFactor,
    ambientTemperatureK: settings.ambientTemperatureK,
    initialThermalState: settings.initialThermalState,
    initialVacuumState: settings.initialVacuumState,
  };
}

/** Stable, human-diffable JSON. Key order is fixed by the serializers above. */
export function toJson(world: SimulationWorld, options: SerializeOptions = {}): string {
  return JSON.stringify(serializeWorld(world, options), null, 2);
}

/* ------------------------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------------------------ */

/**
 * Validates and migrates an unknown value into the current schema version.
 *
 * Every path into the engine from disk, from local storage or from a future database
 * goes through here, so there is exactly one place that has to understand old files.
 */
export function parseAssemblyFile(input: unknown): AssemblyFileV1 {
  if (typeof input !== "object" || input === null) {
    throw new AssemblyFileError("Assembly file must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  const version = record["schemaVersion"];

  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new AssemblyFileError("Assembly file is missing an integer `schemaVersion`.");
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new AssemblyFileError(
      `Assembly file uses schema version ${version}, but this build of ForgeLab only ` +
        `understands up to version ${CURRENT_SCHEMA_VERSION}. Update ForgeLab to open it.`,
    );
  }
  if (version < 1) {
    throw new AssemblyFileError(`Unsupported assembly schema version ${version}.`);
  }

  // Migrations run here, oldest first. Version 1 → 2: every component becomes a plain
  // structural part with no plant parameters, which is exactly what it meant in version 1.
  return validateFile(record, version);
}

export function fromJson(json: string): AssemblyFileV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new AssemblyFileError(
      `Assembly file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseAssemblyFile(parsed);
}

/** Rebuilds a world from a save file and solves it once so its state is immediately live. */
export function deserializeWorld(
  file: AssemblyFileV1,
  options: Omit<WorldOptions, "settings" | "name"> = {},
): SimulationWorld {
  const settings = makeSettings(file.simulationSettings);
  const world = new SimulationWorld({ ...options, name: file.name, settings });

  for (const component of file.components) {
    const geometry = deserializeGeometry(component.geometry);
    const authored = transform(
      toVec3(component.transform.positionM),
      toQuaternion(component.transform.rotation),
    );
    const created = world.addComponent({
      id: component.id,
      type: component.type,
      label: component.label,
      materialId: component.materialId,
      geometry,
      transform: authored,
      connectionPoints: component.connectionPoints.map(deserializeConnectionPoint),
      additionalMassKg: component.additionalMassKg,
      anchored: component.anchored,
      role: component.role,
      parameters: component.parameters,
      ...(component.composition === undefined ? {} : { composition: component.composition }),
    });

    if (component.physical !== undefined) {
      world.restorePhysical(created.id, {
        massKg: created.massKg,
        positionM: toVec3(component.physical.positionM),
        rotation: toQuaternion(component.physical.rotation),
        linearVelocityMps: toVec3(component.physical.linearVelocityMps),
        angularVelocityRadPerSec: toVec3(component.physical.angularVelocityRadPerSec),
      });
    }
  }

  for (const connection of file.connections) {
    world.connect(connection.from, connection.to, {
      id: connection.id,
      type: connection.type,
      ...(connection.maxLoadN === undefined ? {} : { maxLoadN: connection.maxLoadN }),
    });
  }

  world.restoreRuntime({
    tick: file.runtime?.tick ?? 0,
    simulatedTimeSec: file.runtime?.simulatedTimeSec ?? 0,
    idCounter: file.runtime?.idCounter ?? file.components.length + file.connections.length,
  });
  world.solve();
  return world;
}

export function worldFromJson(
  json: string,
  options: Omit<WorldOptions, "settings" | "name"> = {},
): SimulationWorld {
  return deserializeWorld(fromJson(json), options);
}

function deserializeGeometry(geometry: SerializedGeometry): ComponentGeometry {
  if (geometry.kind === "box") {
    return boxGeometry(toVec3(geometry.sizeM), geometry.wallThicknessM);
  }
  if (geometry.kind === "arc") {
    return arcGeometry(
      geometry.bendRadiusM,
      geometry.sweepRad,
      geometry.radiusM,
      geometry.axis,
      geometry.wallThicknessM,
    );
  }
  if (geometry.kind === "torus") {
    return torusGeometry(
      geometry.majorRadiusM,
      geometry.minorRadiusM,
      geometry.axis,
      geometry.wallThicknessM,
    );
  }
  return cylinderGeometry(
    geometry.radiusM,
    geometry.heightM,
    geometry.axis,
    geometry.wallThicknessM,
  );
}

function deserializeConnectionPoint(point: SerializedConnectionPoint): ConnectionPoint {
  return Object.freeze({
    id: point.id,
    localPosition: toVec3(point.localPosition),
    localDirection: toVec3(point.localDirection),
    connectionType: point.connectionType,
    ...(point.maxLoadN === undefined ? {} : { maxLoadN: point.maxLoadN }),
    ...(point.port === undefined ? {} : { port: Object.freeze({ ...point.port }) }),
  });
}

const toVec3 = (v: SerializedVec3) => vec3(v.x, v.y, v.z);
const toQuaternion = (q: SerializedQuaternion) => quaternion(q.x, q.y, q.z, q.w);

function quaternionEquals(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}

/* ------------------------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------------------------ */

function validateFile(record: Record<string, unknown>, version: number): AssemblyFileV1 {
  const name = typeof record["name"] === "string" ? record["name"] : "Untitled Assembly";
  const components = requireArray(record["components"], "components").map((value, index) =>
    validateComponent(value, index, version),
  );
  const connections = requireArray(record["connections"], "connections").map((value, index) =>
    validateConnection(value, index),
  );
  const settings = validateSettings(record["simulationSettings"]);

  const componentIds = new Set(components.map((c) => c.id));
  if (componentIds.size !== components.length) {
    throw new AssemblyFileError("Assembly file contains duplicate component ids.");
  }
  for (const connection of connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (!componentIds.has(endpoint.componentId)) {
        throw new AssemblyFileError(
          `Connection "${connection.id}" references unknown component "${endpoint.componentId}".`,
        );
      }
    }
  }

  const runtime = record["runtime"];
  const meta = record["meta"];

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    components,
    connections,
    simulationSettings: settings,
    ...(isRecord(runtime)
      ? {
          runtime: {
            tick: finiteOr(runtime["tick"], 0),
            simulatedTimeSec: finiteOr(runtime["simulatedTimeSec"], 0),
            idCounter: finiteOr(runtime["idCounter"], 0),
          },
        }
      : {}),
    ...(isRecord(meta)
      ? {
          meta: {
            ...(typeof meta["generator"] === "string" ? { generator: meta["generator"] } : {}),
            ...(typeof meta["savedAtIso"] === "string" ? { savedAtIso: meta["savedAtIso"] } : {}),
          },
        }
      : {}),
  };
}

function validateComponent(value: unknown, index: number, version: number): SerializedComponent {
  if (!isRecord(value)) {
    throw new AssemblyFileError(`components[${index}] is not an object.`);
  }
  const id = requireString(value["id"], `components[${index}].id`);
  const type = requireString(value["type"], `components[${index}].type`);
  const materialId = requireString(value["materialId"], `components[${index}].materialId`);

  return {
    id,
    type,
    label: typeof value["label"] === "string" ? value["label"] : type,
    materialId,
    geometry: validateGeometry(value["geometry"], `components[${index}].geometry`),
    transform: validateTransform(value["transform"], `components[${index}].transform`),
    connectionPoints: requireArray(
      value["connectionPoints"] ?? [],
      `components[${index}].connectionPoints`,
    ).map((point, pointIndex) =>
      validateConnectionPoint(point, `components[${index}].connectionPoints[${pointIndex}]`),
    ),
    additionalMassKg: finiteOr(value["additionalMassKg"], 0),
    anchored: value["anchored"] === true,
    ...(isRecord(value["physical"])
      ? { physical: validatePhysical(value["physical"], `components[${index}].physical`) }
      : {}),
    ...validateRoleAndParameters(value, index, version),
    ...validateComposition(value["composition"], `components[${index}].composition`),
  };
}

function validateRoleAndParameters(
  value: Record<string, unknown>,
  index: number,
  version: number,
): Pick<SerializedComponent, "role" | "parameters"> {
  if (version < 2) return { role: "structure", parameters: {} };
  const role = value["role"] ?? "structure";
  if (!isPlantRole(role)) {
    throw new AssemblyFileError(`components[${index}].role "${String(role)}" is not a known role.`);
  }
  const raw = isRecord(value["parameters"]) ? value["parameters"] : {};
  // resolveParameters drops unknown keys, clamps ranges and defaults wrong types.
  return { role, parameters: { ...resolveParameters(role, raw) } };
}

function validateGeometry(value: unknown, path: string): SerializedGeometry {
  if (!isRecord(value)) throw new AssemblyFileError(`${path} is not an object.`);
  const kind = value["kind"];
  if (kind === "box") {
    return {
      kind: "box",
      sizeM: validateVec3(value["sizeM"], `${path}.sizeM`),
      ...(typeof value["wallThicknessM"] === "number"
        ? { wallThicknessM: value["wallThicknessM"] }
        : {}),
    };
  }
  if (kind === "cylinder") {
    const axis = value["axis"];
    if (axis !== "x" && axis !== "y" && axis !== "z") {
      throw new AssemblyFileError(`${path}.axis must be "x", "y" or "z".`);
    }
    return {
      kind: "cylinder",
      radiusM: requireFinite(value["radiusM"], `${path}.radiusM`),
      heightM: requireFinite(value["heightM"], `${path}.heightM`),
      axis,
      ...(typeof value["wallThicknessM"] === "number"
        ? { wallThicknessM: value["wallThicknessM"] }
        : {}),
    };
  }
  if (kind === "arc") {
    const axis = value["axis"];
    if (axis !== "x" && axis !== "y" && axis !== "z") {
      throw new AssemblyFileError(`${path}.axis must be "x", "y" or "z".`);
    }
    return {
      kind: "arc",
      bendRadiusM: requireFinite(value["bendRadiusM"], `${path}.bendRadiusM`),
      sweepRad: requireFinite(value["sweepRad"], `${path}.sweepRad`),
      radiusM: requireFinite(value["radiusM"], `${path}.radiusM`),
      axis,
      ...(typeof value["wallThicknessM"] === "number"
        ? { wallThicknessM: value["wallThicknessM"] }
        : {}),
    };
  }
  if (kind === "torus") {
    const axis = value["axis"];
    if (axis !== "x" && axis !== "y" && axis !== "z") {
      throw new AssemblyFileError(`${path}.axis must be "x", "y" or "z".`);
    }
    return {
      kind: "torus",
      majorRadiusM: requireFinite(value["majorRadiusM"], `${path}.majorRadiusM`),
      minorRadiusM: requireFinite(value["minorRadiusM"], `${path}.minorRadiusM`),
      axis,
      ...(typeof value["wallThicknessM"] === "number"
        ? { wallThicknessM: value["wallThicknessM"] }
        : {}),
    };
  }
  throw new AssemblyFileError(
    `${path}.kind must be "box", "cylinder" or "torus", received ${String(kind)}.`,
  );
}

function validateTransform(value: unknown, path: string): SerializedTransform {
  if (!isRecord(value)) {
    return { positionM: { x: 0, y: 0, z: 0 }, rotation: serializeQuaternion(QUATERNION_IDENTITY) };
  }
  return {
    positionM: validateVec3(value["positionM"], `${path}.positionM`),
    rotation: validateQuaternion(value["rotation"], `${path}.rotation`),
  };
}

function validatePhysical(value: Record<string, unknown>, path: string): SerializedPhysicalState {
  return {
    positionM: validateVec3(value["positionM"], `${path}.positionM`),
    rotation: validateQuaternion(value["rotation"], `${path}.rotation`),
    linearVelocityMps: validateVec3(value["linearVelocityMps"], `${path}.linearVelocityMps`),
    angularVelocityRadPerSec: validateVec3(
      value["angularVelocityRadPerSec"],
      `${path}.angularVelocityRadPerSec`,
    ),
  };
}

function validateConnectionPoint(value: unknown, path: string): SerializedConnectionPoint {
  if (!isRecord(value)) throw new AssemblyFileError(`${path} is not an object.`);
  const connectionType = value["connectionType"];
  if (!CONNECTION_TYPES.includes(connectionType as ConnectionType)) {
    throw new AssemblyFileError(
      `${path}.connectionType "${String(connectionType)}" is not a known connection type.`,
    );
  }
  return {
    id: requireString(value["id"], `${path}.id`),
    localPosition: validateVec3(value["localPosition"], `${path}.localPosition`),
    localDirection: validateVec3(value["localDirection"], `${path}.localDirection`),
    connectionType: connectionType as ConnectionType,
    ...(typeof value["maxLoadN"] === "number" ? { maxLoadN: value["maxLoadN"] } : {}),
    ...validatePort(value["port"], `${path}.port`),
  };
}

function validatePort(value: unknown, path: string): { port?: PortSpec } {
  if (value === undefined) return {};
  const port = parsePortSpec(value);
  if (port === null) throw new AssemblyFileError(`${path} is not a valid port specification.`);
  return { port };
}

function validateComposition(
  value: unknown,
  path: string,
): { composition?: readonly SerializedMaterialRegion[] } {
  if (value === undefined) return {};
  const regions = requireArray(value, path).map((raw, i) => {
    if (!isRecord(raw)) throw new AssemblyFileError(`${path}[${i}] is not an object.`);
    return {
      id: requireString(raw["id"], `${path}[${i}].id`),
      name: typeof raw["name"] === "string" ? raw["name"].slice(0, 80) : "",
      substanceId: requireString(raw["substanceId"], `${path}[${i}].substanceId`),
      volumeFraction: requireFinite(raw["volumeFraction"], `${path}[${i}].volumeFraction`),
    };
  });
  const problem = compositionError(regions);
  if (problem !== null) throw new AssemblyFileError(`${path}: ${problem}`);
  return { composition: regions };
}

function validateConnection(value: unknown, index: number): SerializedConnection {
  if (!isRecord(value)) throw new AssemblyFileError(`connections[${index}] is not an object.`);
  const type = value["type"];
  if (!CONNECTION_TYPES.includes(type as ConnectionType)) {
    throw new AssemblyFileError(
      `connections[${index}].type "${String(type)}" is not a known connection type.`,
    );
  }
  return {
    id: requireString(value["id"], `connections[${index}].id`),
    type: type as ConnectionType,
    from: validateEndpoint(value["from"], `connections[${index}].from`),
    to: validateEndpoint(value["to"], `connections[${index}].to`),
    ...(typeof value["maxLoadN"] === "number" ? { maxLoadN: value["maxLoadN"] } : {}),
  };
}

function validateEndpoint(
  value: unknown,
  path: string,
): { componentId: string; connectionPointId: string } {
  if (!isRecord(value)) throw new AssemblyFileError(`${path} is not an object.`);
  return {
    componentId: requireString(value["componentId"], `${path}.componentId`),
    connectionPointId: requireString(value["connectionPointId"], `${path}.connectionPointId`),
  };
}

function validateSettings(value: unknown): SerializedSimulationSettings {
  const defaults = makeSettings();
  if (!isRecord(value)) return serializeSettings(defaults);
  const propagation = value["failurePropagation"];
  return {
    gravityMps2: finiteOr(value["gravityMps2"], defaults.gravityMps2),
    fixedTimestepSec: positiveOr(value["fixedTimestepSec"], defaults.fixedTimestepSec),
    groundLevelM: finiteOr(value["groundLevelM"], defaults.groundLevelM),
    designSafetyFactor: positiveOr(value["designSafetyFactor"], defaults.designSafetyFactor),
    failurePropagation: propagation === "detach" ? "detach" : "report-only",
    maxFailureLogEntries: Math.max(
      1,
      Math.floor(finiteOr(value["maxFailureLogEntries"], defaults.maxFailureLogEntries)),
    ),
    bucklingEffectiveLengthFactor: positiveOr(
      value["bucklingEffectiveLengthFactor"],
      defaults.bucklingEffectiveLengthFactor,
    ),
    ambientTemperatureK: positiveOr(value["ambientTemperatureK"], defaults.ambientTemperatureK),
    initialThermalState: value["initialThermalState"] === "cold" ? "cold" : "hot-standby",
    initialVacuumState:
      value["initialVacuumState"] === "atmospheric" ? "atmospheric" : "pumped-down",
  };
}

function validateVec3(value: unknown, path: string): SerializedVec3 {
  if (!isRecord(value)) throw new AssemblyFileError(`${path} is not a vector object.`);
  return {
    x: requireFinite(value["x"], `${path}.x`),
    y: requireFinite(value["y"], `${path}.y`),
    z: requireFinite(value["z"], `${path}.z`),
  };
}

function validateQuaternion(value: unknown, path: string): SerializedQuaternion {
  if (!isRecord(value)) return serializeQuaternion(QUATERNION_IDENTITY);
  return {
    x: requireFinite(value["x"], `${path}.x`),
    y: requireFinite(value["y"], `${path}.y`),
    z: requireFinite(value["z"], `${path}.z`),
    w: requireFinite(value["w"], `${path}.w`),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new AssemblyFileError(`${path} must be an array.`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AssemblyFileError(`${path} must be a non-empty string.`);
  }
  return value;
}

function requireFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AssemblyFileError(`${path} must be a finite number.`);
  }
  return value;
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const positiveOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
