import { PUMP_CONSTRUCTION_RECIPE } from "@forgelab/sim-core";
export const ASSEMBLY_RECIPES = Object.freeze([PUMP_CONSTRUCTION_RECIPE]);
export const findAssemblyRecipe = (id: string) => ASSEMBLY_RECIPES.find((r) => r.id === id);
