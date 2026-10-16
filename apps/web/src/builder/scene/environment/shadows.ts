import { Box3, type Camera, type DirectionalLight, Frustum, Matrix4, Vector3 } from "three";

const DIRECTION = new Vector3(-35, 110, 25).normalize();
const point = new Vector3();
const floor = new Vector3();
const projected = new Box3();
const frustum = new Frustum();
const viewProjection = new Matrix4();

/** Clip the hall floor to the view so architectural shadows never end on visible floor. */
export function includeVisibleFloor(
  bounds: Box3,
  camera: Camera,
  halfX: number,
  halfZ: number,
): void {
  camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProjection);
  let polygon = [
    new Vector3(-halfX, 0, -halfZ),
    new Vector3(halfX, 0, -halfZ),
    new Vector3(halfX, 0, halfZ),
    new Vector3(-halfX, 0, halfZ),
  ];
  for (const plane of frustum.planes) {
    const clipped: Vector3[] = [];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const da = plane.distanceToPoint(a);
      const db = plane.distanceToPoint(b);
      if (da >= 0) clipped.push(a);
      if (da >= 0 !== db >= 0) clipped.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = clipped;
  }
  for (const p of polygon) bounds.expandByPoint(p);
}

/**
 * Spend shadow texels on the machines and their floor shadows, rather than the entire
 * hall. The light direction stays fixed; snapping the projection to whole texels keeps
 * stationary edges stable while a design is edited. Only drawing bounds enter here.
 */
export function fitPlantShadow(light: DirectionalLight, bounds: Box3, mapSize: number): void {
  const shadow = light.shadow;
  const camera = shadow.camera;
  const center = bounds.getCenter(new Vector3());
  const radius = bounds.getSize(new Vector3()).length() / 2;
  // Move along the same ray so even a design far from the origin stays in front of the
  // light. This changes neither illumination direction nor light-space X/Y coordinates.
  light.position.copy(DIRECTION).multiplyScalar(Math.max(150, center.dot(DIRECTION) + radius + 60));
  light.target.position.set(0, 0, 0);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  camera.position.copy(light.position);
  camera.lookAt(light.target.position);
  camera.updateMatrixWorld();
  projected.makeEmpty();

  for (let i = 0; i < 8; i += 1) {
    point.set(
      i & 1 ? bounds.max.x : bounds.min.x,
      i & 2 ? bounds.max.y : bounds.min.y,
      i & 4 ? bounds.max.z : bounds.min.z,
    );
    // The receiver extends beyond the object: a tall vessel's shadow must not be cut off.
    floor.copy(point).addScaledVector(DIRECTION, -point.y / DIRECTION.y);
    projected.expandByPoint(point.applyMatrix4(camera.matrixWorldInverse));
    projected.expandByPoint(floor.applyMatrix4(camera.matrixWorldInverse));
  }

  const axis = (min: number, max: number) => {
    const span = Math.max(32, Math.ceil((max - min + 8) / 2) * 2);
    const texel = span / mapSize;
    const mid = Math.round((min + max) / 2 / texel) * texel;
    return { min: mid - span / 2, max: mid + span / 2, texel };
  };
  const x = axis(projected.min.x, projected.max.x);
  const y = axis(projected.min.y, projected.max.y);
  camera.left = x.min;
  camera.right = x.max;
  camera.bottom = y.min;
  camera.top = y.max;
  // Keep overhead hall hardware eligible to cast onto the build area.
  camera.near = 0.1;
  camera.far = Math.max(200, Math.ceil(-projected.min.z + 20));
  camera.updateProjectionMatrix();
  shadow.bias = -0.0001;
  shadow.normalBias = Math.min(0.03, Math.max(0.003, Math.max(x.texel, y.texel) * 0.35));
  shadow.needsUpdate = true;
}
