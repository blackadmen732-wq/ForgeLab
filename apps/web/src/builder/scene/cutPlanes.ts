import { type Camera, Plane, type Quaternion, Vector3 } from "three";

/**
 * Cutaway planes, one per part: each passes through the part's centre and removes the
 * half nearest the camera (a vertical cut facing the viewer), so every machine opens
 * towards you wherever it stands in the hall. Re-aimed every rendered frame while a cut
 * view is on. The casing, its machine model and its internals share the part's plane, so
 * they are cut in the same place.
 */
const planes = new Map<string, Plane>();

export function cutPlaneFor(componentId: string): Plane {
  let plane = planes.get(componentId);
  if (plane === undefined) {
    plane = new Plane(new Vector3(0, 0, -1), 0);
    planes.set(componentId, plane);
  }
  return plane;
}

const toCamera = new Vector3();
const axisX = new Vector3();
const axisZ = new Vector3();

/**
 * Points the part's plane so the half facing the camera is clipped. The cut is snapped to
 * the part's own horizontal axes — along a machine's shaft or straight across it, as an
 * engineering cutaway is drawn — choosing the one that faces the camera best.
 */
export function aimCutPlane(
  componentId: string,
  centre: Vector3,
  orientation: Quaternion,
  camera: Camera,
): void {
  toCamera.subVectors(camera.position, centre);
  toCamera.y = 0;
  if (toCamera.lengthSq() < 1e-6) toCamera.set(0, 0, 1);
  toCamera.normalize();
  axisX.set(1, 0, 0).applyQuaternion(orientation);
  axisZ.set(0, 0, 1).applyQuaternion(orientation);
  axisX.y = 0;
  axisZ.y = 0;
  const dx = axisX.lengthSq() > 1e-6 ? axisX.normalize().dot(toCamera) : 0;
  const dz = axisZ.lengthSq() > 1e-6 ? axisZ.normalize().dot(toCamera) : 0;
  const facing =
    Math.abs(dx) >= Math.abs(dz)
      ? axisX.multiplyScalar(Math.sign(dx) || 1)
      : axisZ.multiplyScalar(Math.sign(dz) || 1);
  // Three.js keeps the side where n·p + d ≥ 0: n = −facing keeps the far half.
  cutPlaneFor(componentId).setFromNormalAndCoplanarPoint(facing.negate(), centre);
}
