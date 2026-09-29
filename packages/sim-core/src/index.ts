/**
 * `@forgelab/sim-core` — the authoritative ForgeLab simulation engine.
 *
 * This package owns physical truth. It has no dependency on React, Three.js, the DOM or
 * any browser API, and it runs unchanged in Node, in a web worker, or on a server. See
 * `docs/ARCHITECTURE.md` for the rules that keeps it that way.
 */

/**
 * Version of the simulation engine's physics. Stored with every saved version, run record
 * and leaderboard entry: results computed by different engine versions are not compared.
 * Bump the minor version whenever any physical result can change.
 */
export const SIMULATION_ENGINE_VERSION = "0.1.0";

export {
  boxGeometry,
  cylinderGeometry,
  geometryInteriorSurfaceM2,
  geometryInteriorVolumeM3,
  geometryOuterSurfaceM2,
  geometryLocalCenterOfMassM,
  geometryLocalHalfExtentsM,
  geometryVolumeM3,
  dominantLocalAxis,
  loadBearingAreaM2,
  sectionAreaPerpendicularToLocalAxis,
  torusGeometry,
  worldAabb,
  worldBottomY,
  type Aabb,
  type BoxGeometry,
  type ComponentGeometry,
  type CylinderGeometry,
  type GeometryAxis,
  type TorusGeometry,
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
  PORT_DOMAIN_CONNECTION_TYPES,
  checkPortCompatibility,
  parsePortSpec,
  type ControlPort,
  type ElectricalPort,
  type FluidPort,
  type FuelPort,
  type HeatingPort,
  type PortCompatibility,
  type PortDirection,
  type PortDomain,
  type PortFluid,
  type PortSpec,
  type ShaftPort,
  type StructuralPort,
  type VacuumPort,
} from "./ports.js";

export {
  ZERO_STRUCTURAL_STATE,
  ZERO_SUPPORT_STATE,
  componentCenterOfMassM,
  componentHeatCapacityJK,
  compositionError,
  createComponent,
  type MaterialRegion,
  currentTransform,
  initialPhysicalProperties,
  resolveMassKg,
  withComponent,
  withPhysical,
  withPlantState,
  withSolverState,
  type ComponentSpec,
  type ComponentState,
  type ConnectionLoad,
  type PhysicalProperties,
  type SimulationComponent,
  type StructuralMode,
  type StructuralState,
  type SupportMode,
  type SupportState,
} from "./component.js";

export {
  UTILIZATION_FAILURE_THRESHOLD,
  UTILIZATION_STRESSED_THRESHOLD,
  classifyUtilization,
  describeBendingFailure,
  describeBucklingFailure,
  describeConnectionOverload,
  describeYieldFailure,
  failureKey,
  formatQuantity,
  type CausalLink,
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
  type InitialThermalState,
  type InitialVacuumState,
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
  SLENDER_MEMBER_ASPECT_RATIO,
  STRUCTURAL_SOLVER_CONSTANTS,
  solveStructure,
  type StructuralSolveInput,
  type StructuralSolveResult,
} from "./systems/structural.js";

export {
  beamMaxBendingMoment,
  columnBuckling,
  elasticSectionModulusM3,
  extentAlongAxis,
  extremeFibreDistanceM,
  secondMomentOfAreaM4,
  sectionProperties,
  type BeamBendingInput,
  type BeamBendingResult,
  type BeamPointLoad,
  type BucklingResult,
  type MemberRole,
  type SectionProperties,
} from "./systems/members.js";

export { BuiltInDynamicsBackend } from "./dynamics/builtin-backend.js";
export type {
  DynamicsBackend,
  DynamicsStepContext,
  DynamicsStepResult,
} from "./dynamics/backend.js";

export { SimulationLoop, type SimulationLoopOptions } from "./clock.js";
export { SimulationWorld, type SimulationSnapshot, type WorldOptions } from "./world.js";

export {
  CURRENT_SCHEMA_VERSION,
  type AnyAssemblyFile,
  type AssemblyFileV1,
  type AssemblyFileV2,
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

/* ------------------------------------------------------------------------------------ *
 * V0.1 plant physics
 * ------------------------------------------------------------------------------------ */

export {
  COOLED_ROLES,
  PLANT_ROLES,
  ROLE_PARAMETERS,
  booleanParameter,
  isPlantRole,
  numberParameter,
  resolveParameters,
  stringParameter,
  type BooleanParameterSpec,
  type ComponentParameters,
  type EnumParameterSpec,
  type NumberParameterSpec,
  type ParameterSpec,
  type ParameterValue,
  type PlantRole,
} from "./plant/roles.js";

export {
  AMBIENT_TEMPERATURE_K,
  EMPTY_PLANT_METRICS,
  ZERO_PLANT_STATE,
  type ComponentPlantState,
  type ConfidenceLevel,
  type CoolantLoopSummary,
  type CoolantState,
  type ElectricalIslandSummary,
  type ElectricalState,
  type MagnetState,
  type ModelConfidence,
  type PlantMetrics,
  type PlantSummary,
  type PlasmaConfiguration,
  type PlasmaPhase,
  type PlasmaState,
  type SubsystemConfidence,
  type ThermalState,
  type VesselState,
} from "./plant/state.js";

export { PlantSolver, type PlantStepInput, type PlantStepResult } from "./plant/solver.js";
export { worstLevel } from "./plant/confidence.js";
export * as PlantConstants from "./plant/constants.js";

export {
  BOSCH_HALE_DT_MAX_KEV,
  BOSCH_HALE_DT_MIN_KEV,
  DT_ALPHA_FRACTION,
  DT_FUSION_ENERGY_J,
  dtFusionPower,
  dtReactivityM3PerS,
  isWithinBoschHaleRange,
  type FusionPower,
} from "./plant/fusion.js";

export {
  BREMSSTRAHLUNG_COEFFICIENT,
  IPB98_ENVELOPE,
  LOW_Q_KINK_LIMIT,
  TROYON_BETA_N_LIMIT,
  bohmConfinementTimeS,
  bremsstrahlungPowerW,
  edgeSafetyFactor,
  greenwaldDensityLimitM3,
  ipb98y2ConfinementTimeS,
  normalisedBeta,
  ohmicHeatingW,
  plasmaBeta,
  plasmaTemperatureKeV,
  plasmaThermalEnergyJ,
  spitzerResistivityOhmM,
  toroidalPlasmaVolumeM3,
  type Ipb98Inputs,
} from "./plant/plasma.js";

export {
  magneticHoopStressPa,
  magneticPressurePa,
  solenoidOnAxisFieldT,
  toroidalCoilTensionStressPa,
  toroidalFieldT,
  torusEnclosesTorus,
  cylinderSurroundsCoaxially,
} from "./plant/magnetics.js";

export {
  COOLANT_FLUIDS,
  darcyFrictionFactor,
  effectivenessUniformTemperature,
  getCoolantFluid,
  pumpCurve,
  seriesPumpOperatingPoint,
  type CoolantFluid,
  type CoolantFluidId,
} from "./plant/fluids.js";

export {
  findIslands,
  gaussianSolve,
  solveIsland,
  type NetworkEdge,
  type NetworkNode,
} from "./plant/electrical.js";
