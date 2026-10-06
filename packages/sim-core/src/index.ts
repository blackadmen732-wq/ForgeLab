/**
 * `@forgelab/sim-core` — the authoritative ForgeLab simulation engine.
 *
 * This package owns physical truth. It has no dependency on React, Three.js, the DOM or
 * any browser API, and it runs unchanged in Node, in a web worker, or on a server. See
 * `docs/ARCHITECTURE.md` for the rules that keeps it that way.
 */

export {
  boxGeometry,
  cylinderGeometry,
  geometryLocalCenterOfMassM,
  geometryLocalHalfExtentsM,
  geometryVolumeM3,
  dominantLocalAxis,
  loadBearingAreaM2,
  sectionAreaPerpendicularToLocalAxis,
  worldAabb,
  worldBottomY,
  type Aabb,
  type BoxGeometry,
  type ComponentGeometry,
  type CylinderGeometry,
  type GeometryAxis,
} from "./geometry.js";

export {
  CONNECTION_SNAP_TOLERANCE_M,
  CONNECTION_TYPES,
  LOAD_BEARING_CONNECTION_TYPES,
  connectionPoint,
  endpointFor,
  isLoadBearing,
  otherEndpoint,
  type ComponentId,
  type Connection,
  type ConnectionEndpoint,
  type ConnectionId,
  type ConnectionPoint,
  type ConnectionPointId,
  type ConnectionType,
} from "./connections.js";

export {
  ZERO_STRUCTURAL_STATE,
  ZERO_SUPPORT_STATE,
  componentCenterOfMassM,
  createComponent,
  currentTransform,
  initialPhysicalProperties,
  resolveMassKg,
  withComponent,
  withPhysical,
  withSolverState,
  type ComponentSpec,
  type ComponentState,
  type ConnectionLoad,
  type PhysicalProperties,
  type SimulationComponent,
  type StructuralState,
  type SupportMode,
  type SupportState,
} from "./component.js";

export {
  UTILIZATION_FAILURE_THRESHOLD,
  UTILIZATION_STRESSED_THRESHOLD,
  classifyUtilization,
  describeConnectionOverload,
  describeYieldFailure,
  failureKey,
  formatQuantity,
  type FailureEvent,
  type FailureType,
  type SimulationSystemName,
  type StructuralFailureType,
  type StructuralStatus,
} from "./failure.js";

export {
  DEFAULT_FIXED_TIMESTEP_SEC,
  DEFAULT_SIMULATION_SETTINGS,
  SIMULATION_SPEEDS,
  makeSettings,
  type FailurePropagationMode,
  type SimulationSettings,
} from "./settings.js";

export {
  gravitationalForceN,
  gravitationalForceVectorN,
  gravityAccelerationVector,
} from "./systems/gravity.js";

export {
  EMPTY_ASSEMBLY_MASS_PROPERTIES,
  computeAssemblyMassProperties,
  type AssemblyMassProperties,
} from "./systems/center-of-mass.js";

export {
  GROUND_CONTACT_TOLERANCE_M,
  LATERAL_CONNECTION_EPSILON_M,
  STRUCTURAL_SOLVER_CONSTANTS,
  solveStructure,
  type StructuralSolveInput,
  type StructuralSolveResult,
} from "./systems/structural.js";

export { BuiltInDynamicsBackend } from "./dynamics/builtin-backend.js";
export type {
  DynamicsBackend,
  DynamicsStepContext,
  DynamicsStepResult,
} from "./dynamics/backend.js";

export {
  CascadeSolver,
  type CascadeStepContext,
  formatTemperature,
  geometrySurfaceAreaM2,
  plumeExcessK,
} from "./cascade/solver.js";
export { AttributionLedger, CatastropheGraph, labelOf } from "./cascade/graph.js";
export { SpatialHash, distanceToAabb, segmentIntersectsAabb } from "./cascade/spatial-hash.js";
export {
  BATTERY_CHEMISTRIES,
  COMBUSTIBLES,
  GAS_FAMILIES,
  INSULATION_LIMITS,
  STEFAN_BOLTZMANN_W_M2K4,
  WATER,
  HELIUM,
  copperCryogenicSpecificHeatJkgK,
  waterSaturationPressurePa,
  waterSaturationTemperatureK,
  yieldStrengthFactorAt,
  yieldReductionIsSourced,
  type BatteryChemistry,
  type CombustibleKind,
  type GasFamily,
} from "./cascade/data.js";
export { parseCascadePlantSpec } from "./cascade/spec.js";
export type {
  BarrierSpec,
  BatterySpec,
  CascadeNodeSpec,
  CascadePlantSpec,
  CombustibleSpec,
  CoolantLoopSpec,
  CooledLoadSpec,
  CryoplantSpec,
  CryostatSpec,
  ElectricalSpec,
  EnclosureSpec,
  InducedFaultSpec,
  MagnetSpec,
  PipeSpec,
  PlasmaSpec,
  PumpSpec,
} from "./cascade/spec.js";
export {
  CASCADE_MODEL_CONFIDENCE,
  type BatteryCellState,
  type CascadeDiagnosis,
  type CascadeEvent,
  type CascadeEventKind,
  type CascadeNodeState,
  type CascadeSnapshot,
  type ComponentExposure,
  type DebrisParcelState,
  type EnclosureState,
  type HazardEmission,
  type HazardFamily,
  type HazardKind,
  type ModelConfidence,
  type ModelConfidenceEntry,
  type PlasmaState,
} from "./cascade/types.js";

export { SimulationLoop, type SimulationLoopOptions } from "./clock.js";
export { SimulationWorld, type SimulationSnapshot, type WorldOptions } from "./world.js";

export {
  CURRENT_SCHEMA_VERSION,
  type AnyAssemblyFile,
  type AssemblyFileV1,
  type SerializedComponent,
  type SerializedConnection,
  type SerializedConnectionPoint,
  type SerializedGeometry,
  type SerializedPhysicalState,
  type SerializedQuaternion,
  type SerializedRuntime,
  type SerializedSimulationSettings,
  type SerializedTransform,
  type SerializedVec3,
} from "./serialization/schema.js";

export {
  AssemblyFileError,
  deserializeWorld,
  fromJson,
  parseAssemblyFile,
  serializeComponent,
  serializeWorld,
  toJson,
  worldFromJson,
  type SerializeOptions,
} from "./serialization/serialize.js";
