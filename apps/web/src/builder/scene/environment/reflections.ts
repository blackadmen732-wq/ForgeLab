import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  type Texture,
  PMREMGenerator,
  Vector3,
  type WebGLRenderer,
} from "three";

/**
 * What metal surfaces reflect inside the reactor hall: a dark steel box with rows of warm
 * high-bay lamps overhead, a pale clerestory band under the eave, warm wall lights and a
 * dim floor. Rendered once into a prefiltered environment map on the GPU — no download.
 * Presentation only.
 */
function hallReflectionScene(dark: boolean): Scene {
  const scene = new Scene();
  const disposables: Array<{ dispose(): void }> = [];
  const basic = (hex: string, intensity: number) => {
    const m = new MeshBasicMaterial({ color: hex });
    m.color.multiplyScalar(intensity);
    disposables.push(m);
    return m;
  };
  const add = (
    geometry: BoxGeometry | PlaneGeometry,
    material: MeshBasicMaterial,
    x: number,
    y: number,
    z: number,
  ) => {
    disposables.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };

  // The room itself: walls a little lighter than the floor, a near-black roof.
  add(
    new BoxGeometry(140, 50, 90),
    basic(dark ? "#0b0d10" : "#23272c", 1),
    0,
    25,
    0,
  ).material.side = BackSide;
  add(
    new PlaneGeometry(140, 90).rotateX(-Math.PI / 2),
    basic(dark ? "#08090b" : "#1a1c1f", 1),
    0,
    0.05,
    0,
  );
  // High-bay lamps: seven rows of warm sources.
  const lamp = basic("#fff0da", dark ? 6 : 14);
  for (let row = -3; row <= 3; row += 1)
    for (let x = -60; x <= 60; x += 15) add(new BoxGeometry(2.2, 0.2, 2.2), lamp, x, 47, row * 12);
  // Clerestory band of daylight along both long walls (dim after hours).
  const sky = basic("#c9dcf0", dark ? 0.15 : 3.2);
  for (const z of [-44.8, 44.8]) add(new BoxGeometry(130, 3.5, 0.2), sky, 0, 44, z);
  // Broad roof-light strips make cylindrical housings and flat steel readable between
  // the small lamp highlights. The night preset keeps only its existing work lights.
  if (!dark) {
    const roofLight = basic("#e2edfa", 2.5);
    for (const x of [-28, 28]) add(new BoxGeometry(8, 0.2, 72), roofLight, x, 49, 0);
  }
  // Warm wall-mounted work lights at the base of the walls.
  const work = basic("#ffcf8a", dark ? 5 : 7);
  for (let x = -60; x <= 60; x += 20)
    for (const z of [-44.6, 44.6]) add(new BoxGeometry(1.2, 0.5, 0.2), work, x, 9, z);
  for (let z = -35; z <= 35; z += 17.5)
    for (const x of [-69.6, 69.6]) add(new BoxGeometry(0.2, 0.5, 1.2), work, x, 9, z);
  // Reflections match the open service gantry: individual work lights, no fictitious room.
  for (const x of [-26, -14, -2, 10]) add(new BoxGeometry(1.8, 0.3, 0.2), work, x, 11, -44.5);

  scene.userData.dispose = () => disposables.forEach((d) => d.dispose());
  return scene;
}

export function hallReflections(gl: WebGLRenderer, dark: boolean): Texture {
  const pmrem = new PMREMGenerator(gl);
  const scene = hallReflectionScene(dark);
  // Seen from the middle of the build zone, about head height above the plant.
  const texture = pmrem.fromScene(scene, 0.02, 0.1, 400, {
    size: 256,
    position: new Vector3(0, 6, 0),
  }).texture;
  (scene.userData.dispose as () => void)();
  pmrem.dispose();
  return texture;
}
