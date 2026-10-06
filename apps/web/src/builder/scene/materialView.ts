import {
  findFluid,
  findMaterialRecord,
  findSubstance,
  type MaterialCategory,
} from "@forgelab/materials";
import { findComponentDefinition } from "@forgelab/reactor-components";
import type { SimulationComponent } from "@forgelab/sim-core";
import { Color } from "three";

/**
 * The Material view: the plant coloured by what it is made of. Families come from the
 * material library's own categories (fluids from the fluid library); every colour has a
 * text label in the legend, so colour is never the only cue.
 */
export type MaterialFamily = MaterialCategory | "fluid" | "other";

export const MATERIAL_FAMILIES: readonly MaterialFamily[] = [
  "structural-metal",
  "conductor",
  "superconductor",
  "plasma-facing",
  "insulator-ceramic",
  "nuclear",
  "civil",
  "electrochemical",
  "fluid",
  "other",
];

export const FAMILY_LOOK: Readonly<Record<MaterialFamily, { label: string; color: string }>> = {
  "structural-metal": { label: "Structural metals", color: "#8fa3b8" },
  conductor: { label: "Conductors", color: "#d08a4a" },
  superconductor: { label: "Superconductors", color: "#a78bfa" },
  "plasma-facing": { label: "Plasma-facing", color: "#f2c94c" },
  "insulator-ceramic": { label: "Insulators & ceramics", color: "#5fc79a" },
  nuclear: { label: "Breeder & nuclear", color: "#b4e04a" },
  civil: { label: "Concrete & civil", color: "#b7a28c" },
  electrochemical: { label: "Battery cells", color: "#e06c75" },
  fluid: { label: "Coolants & fluids", color: "#4aa3ff" },
  other: { label: "Other", color: "#6b7280" },
};

export function familyOf(id: string): MaterialFamily {
  const record = findMaterialRecord(id as Parameters<typeof findMaterialRecord>[0]);
  if (record !== undefined) return record.category;
  if (findFluid(id) !== undefined) return "fluid";
  return "other";
}

const colours = new Map<MaterialFamily, Color>();
export function familyColor(id: string): Color {
  const family = familyOf(id);
  let c = colours.get(family);
  if (c === undefined) {
    c = new Color(FAMILY_LOOK[family].color);
    colours.set(family, c);
  }
  return c;
}

export function materialName(id: string): string {
  return (
    findSubstance(id as Parameters<typeof findSubstance>[0])?.name ?? findFluid(id)?.name ?? id
  );
}

/** Every material a part contains: its body's and its internal regions'. */
export function materialsIn(c: SimulationComponent): ReadonlySet<string> {
  const out = new Set<string>([c.materialId]);
  for (const internal of findComponentDefinition(c.type)?.product.internals ?? [])
    if (internal.substanceId !== null) out.add(internal.substanceId);
  return out;
}

/** Materials used in the design → the parts that contain each, grouped by family. */
export function materialUsage(
  components: readonly SimulationComponent[],
): Map<MaterialFamily, Map<string, string[]>> {
  const out = new Map<MaterialFamily, Map<string, string[]>>();
  for (const c of components) {
    for (const id of materialsIn(c)) {
      const family = familyOf(id);
      const byId = out.get(family) ?? new Map<string, string[]>();
      byId.set(id, [...(byId.get(id) ?? []), c.id]);
      out.set(family, byId);
    }
  }
  return out;
}
