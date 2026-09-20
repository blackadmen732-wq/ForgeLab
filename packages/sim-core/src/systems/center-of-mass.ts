import { type Kilograms, type Vec3, VEC3_ZERO, Vec3Math } from "@forgelab/shared";
import { componentCenterOfMassM, type SimulationComponent } from "../component.js";

/** Mass properties of a whole assembly. */
export interface AssemblyMassProperties {
  readonly totalMassKg: Kilograms;
  /**
   * Mass-weighted mean position of every component, in world space.
   *
   * For an empty or massless assembly this is the origin, and `totalMassKg` is 0 —
   * callers should check the mass before reading anything into the position.
   */
  readonly centerOfMassM: Vec3;
  readonly componentCount: number;
}

export const EMPTY_ASSEMBLY_MASS_PROPERTIES: AssemblyMassProperties = Object.freeze({
  totalMassKg: 0,
  centerOfMassM: VEC3_ZERO,
  componentCount: 0,
});

/**
 * Assembly centre of mass: sum(m_i * r_i) / sum(m_i).
 *
 * `r_i` is each component's own centre of mass in world space, so a future component
 * with an off-centre mass distribution contributes correctly without changing this code.
 */
export function computeAssemblyMassProperties(
  components: readonly SimulationComponent[],
): AssemblyMassProperties {
  let totalMassKg = 0;
  let weighted = VEC3_ZERO;

  for (const component of components) {
    const massKg = component.massKg;
    if (massKg <= 0) continue;
    totalMassKg += massKg;
    weighted = Vec3Math.add(weighted, Vec3Math.scale(componentCenterOfMassM(component), massKg));
  }

  if (totalMassKg <= 0) {
    return Object.freeze({
      totalMassKg: 0,
      centerOfMassM: VEC3_ZERO,
      componentCount: components.length,
    });
  }

  return Object.freeze({
    totalMassKg,
    centerOfMassM: Vec3Math.scale(weighted, 1 / totalMassKg),
    componentCount: components.length,
  });
}
