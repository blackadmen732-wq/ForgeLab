export type { MaterialDefinition, MaterialId } from "./types.js";
export type {
  Confidence,
  Curve,
  ElectricalProperties,
  FluidRecord,
  FluidRelease,
  FluidState,
  MagneticProperties,
  MaterialCategory,
  MaterialRecord,
  MechanicalProperties,
  NuclearProperties,
  PlasmaFacingProperties,
  PresentationProperties,
  Quantity,
  SuperconductingProperties,
  ThermalProperties,
  ThermalResponse,
} from "./schema.js";
export {
  MATERIAL_CATALOG,
  MaterialIds,
  findMaterial,
  getMaterial,
  listMaterialIds,
  structuralDefinition,
  type KnownMaterialId,
} from "./catalog.js";
export { MATERIAL_LIBRARY } from "./library.js";
export { FLUID_LIBRARY } from "./fluids.js";
export { SOURCES, sourceCitation, type SourceReference } from "./sources.js";
export { curveValue } from "./curves.js";
export {
  SUBSTANCE_CATALOG,
  criticalTemperatureK,
  findFluid,
  findMaterialRecord,
  findSubstance,
  getSubstance,
  upperCriticalFieldT,
  type Combustion,
  type SubstanceDefinition,
  type SuperconductorProperties,
} from "./substances.js";
