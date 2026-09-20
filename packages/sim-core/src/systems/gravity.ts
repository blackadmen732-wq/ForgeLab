import {
  type Kilograms,
  type MetersPerSecondSquared,
  type Newtons,
  type Vec3,
  Vec3Math,
  vec3,
} from "@forgelab/shared";

/**
 * Weight of a mass in a uniform gravitational field: F = m * g.
 *
 * Returned as a magnitude in newtons. ForgeLab treats g as uniform and vertical
 * everywhere in the workspace; there is no altitude variation and no other body.
 */
export function gravitationalForceN(
  massKg: Kilograms,
  gravityMps2: MetersPerSecondSquared,
): Newtons {
  return massKg * gravityMps2;
}

/** Gravitational acceleration as a world-space vector (down the -Y axis). */
export function gravityAccelerationVector(gravityMps2: MetersPerSecondSquared): Vec3 {
  return vec3(0, -gravityMps2, 0);
}

/** Gravitational force as a world-space vector. */
export function gravitationalForceVectorN(
  massKg: Kilograms,
  gravityMps2: MetersPerSecondSquared,
): Vec3 {
  return Vec3Math.scale(gravityAccelerationVector(gravityMps2), massKg);
}
