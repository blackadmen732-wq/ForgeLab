import { useLayoutEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { currentTransform, worldAabb } from "@forgelab/sim-core";
import { useEditor } from "../store/context.js";

/** Height of the reference person, m (hard hat included). */
export const SCALE_FIGURE_HEIGHT_M = 1.75;

/**
 * Where the reference person stands: on the floor just in front (+z, the default camera's
 * side) of what is selected, or of the whole design. Pure presentation.
 */
export function scaleFigurePosition(
  boxes: readonly { minM: { x: number; z: number }; maxM: { x: number; z: number } }[],
): [number, number, number] {
  if (boxes.length === 0) return [0, 0, 4];
  let minX = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.minM.x);
    maxX = Math.max(maxX, b.maxM.x);
    maxZ = Math.max(maxZ, b.maxM.z);
  }
  return [(minX + maxX) / 2 + 0.6, 0, maxZ + 1.2];
}

/** A maintenance worker in overalls, hi-vis vest and hard hat, built to 1.75 m. */
function buildFigure(): { group: Group; dispose: () => void } {
  const overalls = new MeshStandardMaterial({ color: "#2f4a6b", roughness: 0.85 });
  const vest = new MeshStandardMaterial({ color: "#e8d22a", roughness: 0.6, emissive: "#332e05" });
  const skin = new MeshStandardMaterial({ color: "#c79a7a", roughness: 0.7 });
  const hat = new MeshStandardMaterial({ color: "#f07a1a", roughness: 0.45 });
  const boots = new MeshStandardMaterial({ color: "#1d1d1f", roughness: 0.9 });
  const geometries: BufferGeometry[] = [];
  const group = new Group();
  group.name = "scale-figure";
  const add = (g: BufferGeometry, m: MeshStandardMaterial, x: number, y: number, z = 0) => {
    geometries.push(g);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    // Never picked: the figure is a ruler, not a part.
    mesh.raycast = () => undefined;
    group.add(mesh);
    return mesh;
  };
  for (const s of [-1, 1]) {
    add(new BoxGeometry(0.12, 0.08, 0.26), boots, s * 0.1, 0.04, 0.03);
    add(new CapsuleGeometry(0.075, 0.68, 4, 10), overalls, s * 0.1, 0.5);
    const arm = add(new CapsuleGeometry(0.055, 0.56, 4, 10), overalls, s * 0.27, 1.12);
    arm.rotation.z = s * 0.08;
    add(new SphereGeometry(0.05, 10, 8), skin, s * 0.29, 0.8);
  }
  add(new BoxGeometry(0.4, 0.58, 0.22), overalls, 0, 1.12);
  add(new BoxGeometry(0.42, 0.42, 0.24), vest, 0, 1.17);
  add(new CapsuleGeometry(0.05, 0.05, 4, 8), skin, 0, 1.47);
  add(new SphereGeometry(0.105, 16, 12), skin, 0, 1.58);
  // Hard hat: a dome and a brim, crown at 1.75 m.
  add(new SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hat, 0, 1.63);
  add(new BoxGeometry(0.27, 0.015, 0.29), hat, 0, 1.635);
  const materials = [overalls, vest, skin, hat, boots];
  return {
    group,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

export function ScaleFigure() {
  const show = useEditor((v) => v.showScale);
  const components = useEditor((v) => v.snapshot.components);
  const selection = useEditor((v) => v.selection);
  const hidden = useEditor((v) => v.hidden);
  const figure = useMemo(() => (show ? buildFigure() : null), [show]);
  useLayoutEffect(() => () => figure?.dispose(), [figure]);
  const position = useMemo(() => {
    const picked = new Set(selection);
    const pool = components.filter((c) => (picked.size > 0 ? picked.has(c.id) : !hidden.has(c.id)));
    return scaleFigurePosition(pool.map((c) => worldAabb(c.geometry, currentTransform(c))));
  }, [components, selection, hidden]);
  if (figure === null) return null;
  return <primitive object={figure.group} position={position} />;
}
