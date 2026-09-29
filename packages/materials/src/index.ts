export type { MaterialDefinition, MaterialId } from "./types.js";
export {
  MATERIAL_CATALOG,
  MaterialIds,
  findMaterial,
  getMaterial,
  listMaterialIds,
  type KnownMaterialId,
} from "./catalog.js";
export {
  SUBSTANCE_CATALOG,
  criticalTemperatureK,
  findSubstance,
  getSubstance,
  upperCriticalFieldT,
  type SubstanceDefinition,
  type SuperconductorProperties,
} from "./substances.js";
