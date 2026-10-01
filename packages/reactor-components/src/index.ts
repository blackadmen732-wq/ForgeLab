export {
  COMPONENT_CATEGORIES,
  buildConnectionPoints,
  productComposition,
  structuralSocketCapacityN,
  type AnimationHook,
  type AudioProfileId,
  type ComponentCategory,
  type ComponentDefinition,
  type PhysicsDomain,
  type ProductFailureMode,
  type ProductInfo,
  REGION_KINDS,
  type ProductInternal,
  type RegionKind,
  type ProductRating,
  type VisualProfileId,
  type PlacementOptions,
  type SocketTemplate,
} from "./definition.js";

export * from "./builtin.js";

export {
  TOKAMAK_CENTRE_Y,
  buildBenchmark,
  buildOverloadDemo,
  buildReferencePlant,
  buildStarterAssembly,
  placePart,
  type ReferencePlantOptions,
} from "./designs.js";

export { PLANT_BUS_V, V01_PORTS, V01_PRODUCTS } from "./products.js";
export { SHOWROOM_SCENARIOS, buildScenario, type ShowroomScenario } from "./scenarios.js";
