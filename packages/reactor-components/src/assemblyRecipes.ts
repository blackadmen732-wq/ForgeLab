import { CONSTRUCTION_RECIPES } from "@forgelab/sim-core";
export const ASSEMBLY_RECIPES = Object.freeze([...CONSTRUCTION_RECIPES]);
export const findAssemblyRecipe = (id: string) => ASSEMBLY_RECIPES.find((r) => r.id === id);
