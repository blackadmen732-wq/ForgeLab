export * from "./units.js";
export * from "./math.js";
export * from "./snapping.js";

export type { Vec3 } from "./vec3.js";
export type { Quaternion } from "./quaternion.js";
export type { Transform } from "./transform.js";

export {
  IDENTITY_TRANSFORM,
  composeTransforms,
  localDirectionToWorld,
  localPointToWorld,
  transform,
  withPosition,
  withRotation,
  worldPointToLocal,
} from "./transform.js";

export * as Vec3Math from "./vec3.js";
export * as QuaternionMath from "./quaternion.js";

export { AXIS_X, AXIS_Y, AXIS_Z, DOWN, UP, VEC3_ONE, VEC3_ZERO, vec3 } from "./vec3.js";

export { QUATERNION_IDENTITY, quaternion } from "./quaternion.js";

export {
  linearCopies,
  mirrorCopies,
  radialCopies,
  type LinearPattern,
  type MirrorPlane,
  type RadialPattern,
} from "./patterns.js";
