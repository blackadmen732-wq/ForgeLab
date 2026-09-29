import {
  type Transform,
  type Vec3,
  VACUUM_PERMEABILITY_H_PER_M,
  Vec3Math,
  localDirectionToWorld,
  worldPointToLocal,
} from "@forgelab/shared";
import type { ComponentGeometry, GeometryAxis } from "../geometry.js";

/**
 * Magnetic field models for V0.1.
 *
 * Only two coil geometries are supported, each with an exact closed-form field:
 *  - an ideal toroidal winding (a toroidal-field coil set treated as a continuous winding),
 *  - a finite solenoid, evaluated ON ITS AXIS only.
 * ForgeLab does NOT solve arbitrary 3D coil geometry. Off-axis solenoid contributions and
 * coils that are not coaxial with a vessel are excluded, and any design relying on them
 * is labelled "experimental".
 */

/**
 * Field inside an ideal toroidal winding at distance r from the axis (Ampère's law):
 *   B(r) = μ₀ N I / (2π r)
 * Exact for a continuous winding; a real set of N discrete coils adds a small toroidal
 * ripple that V0.1 ignores.
 */
export function toroidalFieldT(totalTurns: number, currentA: number, radiusM: number): number {
  if (!(radiusM > 0)) return 0;
  return (VACUUM_PERMEABILITY_H_PER_M * totalTurns * currentA) / (2 * Math.PI * radiusM);
}

/**
 * On-axis field of a finite solenoid (length L, radius R, N turns, current I) at axial
 * distance z from its centre (Biot–Savart integrated over a uniform current sheet):
 *   B(z) = (μ₀ N I / 2L) · [ (z + L/2) / √((z + L/2)² + R²) − (z − L/2) / √((z − L/2)² + R²) ]
 * At the centre of a long solenoid this tends to μ₀ N I / L.
 */
export function solenoidOnAxisFieldT(params: {
  turns: number;
  currentA: number;
  lengthM: number;
  radiusM: number;
  axialOffsetM: number;
}): number {
  const { turns: N, currentA: I, lengthM: L, radiusM: R, axialOffsetM: z } = params;
  if (!(L > 0) || !(R > 0)) return 0;
  const a = z + L / 2;
  const b = z - L / 2;
  return (
    ((VACUUM_PERMEABILITY_H_PER_M * N * I) / (2 * L)) *
    (a / Math.sqrt(a * a + R * R) - b / Math.sqrt(b * b + R * R))
  );
}

/** Magnetic pressure B² / 2μ₀, Pa. */
export function magneticPressurePa(fieldT: number): number {
  return (fieldT * fieldT) / (2 * VACUUM_PERMEABILITY_H_PER_M);
}

/**
 * Hoop stress in a thin solenoid winding from its own field: σ = p · r / t, p = B²/2μ₀.
 * Exact for a long thin solenoid whose winding pack carries the load; ForgeLab uses the
 * casing wall as that pack (DOCUMENTED APPROXIMATION).
 */
export function magneticHoopStressPa(fieldT: number, radiusM: number, wallM: number): number {
  if (!(wallM > 0)) return Infinity;
  return (magneticPressurePa(fieldT) * radiusM) / wallM;
}

/**
 * Mean tensile stress in the structure of a toroidal-field coil set.
 *
 * The total in-plane tension of an ideal toroidal winding with N·I ampere-turns whose coils
 * run between inner and outer leg radii R₁ and R₂ is (the constant-tension "Princeton D"
 * result):
 *     T_total = μ₀ (N I)² ln(R₂/R₁) / (4π)
 * summed over all coils. A horizontal cut through the mid-plane crosses every coil twice,
 * so 2·T_total is carried by the structural area that cut intersects, `midplaneAreaM2`.
 *
 * Reference: J. File, R. G. Mills and G. V. Sheffield, "Large superconducting magnet
 * designs for fusion reactors", IEEE Trans. Nucl. Sci. 18 (1971) 277.
 * DOCUMENTED APPROXIMATION: the whole casing section shares the tension evenly; out-of-
 * plane forces, the inboard centring force and bending are not modelled.
 */
export function toroidalCoilTensionStressPa(params: {
  ampereTurns: number;
  innerLegRadiusM: number;
  outerLegRadiusM: number;
  midplaneAreaM2: number;
}): number {
  if (!(params.midplaneAreaM2 > 0) || !(params.innerLegRadiusM > 0)) return Infinity;
  const tension =
    (VACUUM_PERMEABILITY_H_PER_M *
      params.ampereTurns ** 2 *
      Math.log(params.outerLegRadiusM / params.innerLegRadiusM)) /
    (4 * Math.PI);
  return (2 * tension) / params.midplaneAreaM2;
}

const AXES: Record<GeometryAxis, Vec3> = {
  x: Object.freeze({ x: 1, y: 0, z: 0 }),
  y: Object.freeze({ x: 0, y: 1, z: 0 }),
  z: Object.freeze({ x: 0, y: 0, z: 1 }),
};

/** World-space symmetry axis of a cylinder or torus. */
export function worldSymmetryAxis(geometry: ComponentGeometry, placement: Transform): Vec3 {
  const axis = geometry.kind === "box" ? "y" : geometry.axis;
  return localDirectionToWorld(placement, AXES[axis]);
}

/** Relative placement of `inner` in the symmetry frame of `outer`. */
export interface CoaxialRelation {
  /** |cos| of the angle between the two symmetry axes (1 = parallel). */
  readonly axisAlignment: number;
  /** Distance from the inner centre to the outer's axis line, m. */
  readonly radialOffsetM: number;
  /** Signed distance of the inner centre along the outer's axis, m. */
  readonly axialOffsetM: number;
}

export function coaxialRelation(
  outer: { geometry: ComponentGeometry; placement: Transform },
  inner: { geometry: ComponentGeometry; placement: Transform },
): CoaxialRelation {
  const outerAxis = worldSymmetryAxis(outer.geometry, outer.placement);
  const innerAxis = worldSymmetryAxis(inner.geometry, inner.placement);
  const local = worldPointToLocal(outer.placement, inner.placement.positionM);
  const axisName = outer.geometry.kind === "box" ? "y" : outer.geometry.axis;
  const axial = local[axisName];
  const radial = Math.sqrt(Math.max(0, Vec3Math.lengthSquared(local) - axial * axial));
  return {
    axisAlignment: Math.abs(Vec3Math.dot(outerAxis, innerAxis)),
    radialOffsetM: radial,
    axialOffsetM: axial,
  };
}

/** Tolerances for treating two parts as coaxial. Authoring tolerances, not physics. */
export const COAXIAL_ALIGNMENT_MIN = 0.999; // within ~2.6 degrees
export const COAXIAL_OFFSET_MAX_M = 0.1;

/**
 * True when torus `outer` wraps around torus `inner`: coaxial, co-centred and with the
 * inner tube lying entirely inside the outer tube's bore. Used for coil sets and blankets
 * around a toroidal vessel.
 */
export function torusEnclosesTorus(
  outer: { geometry: ComponentGeometry; placement: Transform },
  inner: { geometry: ComponentGeometry; placement: Transform },
): boolean {
  if (outer.geometry.kind !== "torus" || inner.geometry.kind !== "torus") return false;
  const relation = coaxialRelation(outer, inner);
  if (relation.axisAlignment < COAXIAL_ALIGNMENT_MIN) return false;
  if (relation.radialOffsetM > COAXIAL_OFFSET_MAX_M) return false;
  if (Math.abs(relation.axialOffsetM) > COAXIAL_OFFSET_MAX_M) return false;
  const bore = outer.geometry.minorRadiusM - (outer.geometry.wallThicknessM ?? 0);
  const dR = Math.abs(outer.geometry.majorRadiusM - inner.geometry.majorRadiusM);
  return dR + inner.geometry.minorRadiusM <= bore + 1e-9;
}

/**
 * True when cylinder shell `outer` surrounds cylinder `inner` coaxially (radially outside
 * it). Axial overlap is not required: a coaxial coil beyond the end of a vessel still
 * contributes on-axis field, which `solenoidOnAxisFieldT` accounts for.
 */
export function cylinderSurroundsCoaxially(
  outer: { geometry: ComponentGeometry; placement: Transform },
  inner: { geometry: ComponentGeometry; placement: Transform },
): boolean {
  if (outer.geometry.kind !== "cylinder" || inner.geometry.kind !== "cylinder") return false;
  const relation = coaxialRelation(outer, inner);
  if (relation.axisAlignment < COAXIAL_ALIGNMENT_MIN) return false;
  if (relation.radialOffsetM > COAXIAL_OFFSET_MAX_M) return false;
  const bore = outer.geometry.radiusM - (outer.geometry.wallThicknessM ?? 0);
  return inner.geometry.radiusM <= bore + 1e-9;
}
