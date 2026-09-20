import {
  QUATERNION_IDENTITY,
  type Quaternion,
  multiply,
  rotateVec3,
  inverseRotateVec3,
} from "./quaternion.js";
import { type Vec3, VEC3_ZERO, add, subtract } from "./vec3.js";

/**
 * Rigid-body placement: where a component sits and how it is oriented.
 *
 * ForgeLab deliberately has no scale term. A component's size lives in its geometry, in
 * metres, so that mass, volume and cross-sectional area can never disagree with what is
 * drawn. Scaling a rendered mesh without scaling its geometry would silently break mass.
 */
export interface Transform {
  readonly positionM: Vec3;
  readonly rotation: Quaternion;
}

export const IDENTITY_TRANSFORM: Transform = Object.freeze({
  positionM: VEC3_ZERO,
  rotation: QUATERNION_IDENTITY,
});

export function transform(positionM: Vec3, rotation: Quaternion = QUATERNION_IDENTITY): Transform {
  return Object.freeze({ positionM, rotation });
}

/** Maps a point expressed in the component's local frame into world space. */
export function localPointToWorld(t: Transform, localPoint: Vec3): Vec3 {
  return add(t.positionM, rotateVec3(t.rotation, localPoint));
}

/** Maps a world-space point into the component's local frame. */
export function worldPointToLocal(t: Transform, worldPoint: Vec3): Vec3 {
  return inverseRotateVec3(t.rotation, subtract(worldPoint, t.positionM));
}

/** Maps a local direction into world space (rotation only, no translation). */
export function localDirectionToWorld(t: Transform, localDirection: Vec3): Vec3 {
  return rotateVec3(t.rotation, localDirection);
}

/** Composes two transforms: `child` expressed relative to `parent`, resolved to world. */
export function composeTransforms(parent: Transform, child: Transform): Transform {
  return transform(
    localPointToWorld(parent, child.positionM),
    multiply(parent.rotation, child.rotation),
  );
}

export function withPosition(t: Transform, positionM: Vec3): Transform {
  return transform(positionM, t.rotation);
}

export function withRotation(t: Transform, rotation: Quaternion): Transform {
  return transform(t.positionM, rotation);
}
