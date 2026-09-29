import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  type Group,
  MeshStandardMaterial,
  PlaneGeometry,
  CylinderGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EnvironmentPreset } from "./presets.js";
import { concreteTexture } from "./textures.js";

/**
 * The reactor assembly hall. Presentation only: nothing here is read by physics, and the
 * floor is not the ground the solver uses (that is always y = 0, which this floor sits on).
 *
 * Geometry is generated procedurally and merged per material, so the whole hall costs a
 * dozen draw calls. Walls and the roof hide themselves whenever the camera is outside
 * them, so top views and orbiting from far away still see the plant.
 */
export const HALL = Object.freeze({
  /** Half-extents of the floor, m. */
  halfX: 70,
  halfZ: 45,
  eaveM: 28,
  roofM: 31,
  bayM: 10,
});

type Part = BufferGeometry;

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number): Part {
  return new BoxGeometry(sx, sy, sz).translate(x, y, z);
}

/** A straight member between two points in the YZ plane at a given x. */
function strutYZ(x: number, y0: number, z0: number, y1: number, z1: number, t: number): Part {
  const dy = y1 - y0;
  const dz = z1 - z0;
  const length = Math.hypot(dy, dz);
  return new BoxGeometry(t, t, length)
    .rotateX(-Math.atan2(dy, dz))
    .translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** A straight member between two points in the XY plane at a given z. */
function strutXY(z: number, x0: number, y0: number, x1: number, y1: number, t: number): Part {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  return new BoxGeometry(length, t, t)
    .rotateZ(Math.atan2(dy, dx))
    .translate((x0 + x1) / 2, (y0 + y1) / 2, z);
}

/** Wide-flange column (I section) standing on the floor. */
function column(x: number, z: number, height: number, alongX: boolean): Part[] {
  const flange = 0.7;
  const depth = 0.8;
  const tf = 0.06;
  const tw = 0.05;
  if (alongX) {
    return [
      box(flange, height, tf, x, height / 2, z - depth / 2),
      box(flange, height, tf, x, height / 2, z + depth / 2),
      box(tw, height, depth, x, height / 2, z),
    ];
  }
  return [
    box(tf, height, flange, x - depth / 2, height / 2, z),
    box(tf, height, flange, x + depth / 2, height / 2, z),
    box(depth, height, tw, x, height / 2, z),
  ];
}

function merge(parts: Part[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (merged === null) throw new Error("hall geometry could not be merged");
  return merged;
}

interface HallGeometry {
  readonly steelBySide: Record<Side, BufferGeometry>;
  readonly claddingBySide: Record<Side, BufferGeometry>;
  readonly plinthBySide: Record<Side, BufferGeometry>;
  readonly windowsBySide: Record<Side, BufferGeometry>;
  readonly roofSteel: BufferGeometry;
  readonly roof: BufferGeometry;
  readonly fixtures: BufferGeometry;
  readonly crane: BufferGeometry;
  readonly craneSteel: BufferGeometry;
  readonly gallery: BufferGeometry;
  readonly galleryRails: BufferGeometry;
  readonly markings: BufferGeometry;
  readonly hazard: BufferGeometry;
  readonly door: BufferGeometry;
}

type Side = "north" | "south" | "east" | "west";
const SIDES: readonly Side[] = ["north", "south", "east", "west"];

function buildHall(): HallGeometry {
  const { halfX: X, halfZ: Z, eaveM: H, roofM: R, bayM: bay } = HALL;
  const steel: Record<Side, Part[]> = { north: [], south: [], east: [], west: [] };
  const cladding: Record<Side, Part[]> = { north: [], south: [], east: [], west: [] };
  const plinth: Record<Side, Part[]> = { north: [], south: [], east: [], west: [] };
  const windows: Record<Side, Part[]> = { north: [], south: [], east: [], west: [] };

  // Columns, girts and cladding on the long walls (north z = -Z, south z = +Z).
  for (const [side, z] of [
    ["north", -Z],
    ["south", Z],
  ] as const) {
    for (let x = -X; x <= X + 0.01; x += bay) steel[side].push(...column(x, z, H, true));
    for (const y of [3, 9, 15, 21]) steel[side].push(box(2 * X, 0.25, 0.2, 0, y, z));
    const out = Math.sign(z) * 0.55;
    cladding[side].push(box(2 * X + 1, H, 0.12, 0, H / 2, z + out));
    plinth[side].push(box(2 * X + 1, 2.4, 0.3, 0, 1.2, z + out * 0.8));
    windows[side].push(box(2 * X - 4, 3.2, 0.05, 0, 23.8, z + out * 0.85));
    // Crane runway on corbels.
    const inward = -Math.sign(z);
    for (let x = -X; x <= X + 0.01; x += bay)
      steel[side].push(box(0.6, 1.2, 1.4, x, 19.4, z + inward * 1.0));
    steel[side].push(box(2 * X, 1.0, 0.7, 0, 20.5, z + inward * 1.6));
  }
  // Short walls (west x = -X, east x = +X).
  for (const [side, x] of [
    ["west", -X],
    ["east", X],
  ] as const) {
    for (let z = -Z + bay; z <= Z - bay + 0.01; z += bay)
      steel[side].push(...column(x, z, H, false));
    for (const y of [3, 9, 15, 21]) steel[side].push(box(0.2, 0.25, 2 * Z, x, y, 0));
    const out = Math.sign(x) * 0.55;
    cladding[side].push(box(0.12, H, 2 * Z + 1, x + out, H / 2, 0));
    plinth[side].push(box(0.3, 2.4, 2 * Z + 1, x + out * 0.8, 1.2, 0));
    windows[side].push(box(0.05, 3.2, 2 * Z - 4, x + out * 0.85, 23.8, 0));
  }
  // Gable infill between eave and roof on every side.
  cladding.north.push(box(2 * X + 1, R - H, 0.12, 0, (H + R) / 2, -Z - 0.55));
  cladding.south.push(box(2 * X + 1, R - H, 0.12, 0, (H + R) / 2, Z + 0.55));
  cladding.west.push(box(0.12, R - H, 2 * Z + 1, -X - 0.55, (H + R) / 2, 0));
  cladding.east.push(box(0.12, R - H, 2 * Z + 1, X + 0.55, (H + R) / 2, 0));

  // Large roll-up equipment door in the east wall.
  const door: Part[] = [];
  const doorW = 18;
  const doorH = 16;
  for (let y = 0.4; y < doorH; y += 0.4) door.push(box(0.08, 0.34, doorW, X + 0.35, y, 0));
  steel.east.push(box(0.6, doorH + 1, 0.6, X, (doorH + 1) / 2, -doorW / 2 - 0.3));
  steel.east.push(box(0.6, doorH + 1, 0.6, X, (doorH + 1) / 2, doorW / 2 + 0.3));
  steel.east.push(box(0.6, 1, doorW + 1.2, X, doorH + 0.5, 0));

  // Roof trusses spanning north–south on every column line.
  const roofSteel: Part[] = [];
  const bottom = H - 0.5;
  const top = R - 0.4;
  for (let x = -X; x <= X + 0.01; x += bay) {
    roofSteel.push(box(0.35, 0.35, 2 * Z, x, bottom, 0));
    roofSteel.push(box(0.35, 0.35, 2 * Z, x, top, 0));
    const panel = 5;
    for (let z = -Z; z < Z - 0.01; z += panel) {
      roofSteel.push(box(0.22, top - bottom, 0.22, x, (top + bottom) / 2, z));
      const up = Math.round((z + Z) / panel) % 2 === 0;
      roofSteel.push(strutYZ(x, up ? bottom : top, z, up ? top : bottom, z + panel, 0.18));
    }
  }
  // Purlins and bracing between trusses.
  for (let z = -Z; z <= Z + 0.01; z += 7.5) roofSteel.push(box(2 * X, 0.25, 0.2, 0, top + 0.3, z));
  for (let x = -X; x < X - 0.01; x += bay) {
    roofSteel.push(strutXY(-Z + 2, x, bottom, x + bay, top, 0.12));
    roofSteel.push(strutXY(Z - 2, x, top, x + bay, bottom, 0.12));
  }
  const roof = [box(2 * X + 1.2, 0.3, 2 * Z + 1.2, 0, R, 0)];

  // High-bay light fixtures hung below the trusses.
  const fixtures: Part[] = [];
  for (let x = -X + bay / 2; x < X; x += bay) {
    for (let z = -Z + 9; z <= Z - 9 + 0.01; z += 13.5) {
      fixtures.push(new CylinderGeometry(0.75, 0.9, 0.35, 20).translate(x, bottom - 1.6, z));
    }
  }

  // Bridge crane parked over the west end of the assembly bay.
  const crane: Part[] = [];
  const craneSteel: Part[] = [];
  const cx = -30;
  const span = 2 * Z - 3.2;
  crane.push(box(1.2, 1.8, span, cx - 1.6, 21.9, 0));
  crane.push(box(1.2, 1.8, span, cx + 1.6, 21.9, 0));
  crane.push(box(4.6, 1.2, 2.4, cx, 21.4, -Z + 2.2));
  crane.push(box(4.6, 1.2, 2.4, cx, 21.4, Z - 2.2));
  crane.push(box(3.2, 1.6, 3.0, cx, 23.4, -6)); // trolley
  craneSteel.push(new CylinderGeometry(0.05, 0.05, 11, 6).translate(cx - 0.4, 17.3, -6));
  craneSteel.push(new CylinderGeometry(0.05, 0.05, 11, 6).translate(cx + 0.4, 17.3, -6));
  crane.push(box(1.4, 1.6, 0.9, cx, 11.4, -6)); // hook block
  craneSteel.push(
    new CylinderGeometry(0.22, 0.22, 0.25, 12).rotateZ(Math.PI / 2).translate(cx, 10.4, -6),
  );

  // Service gallery along the north wall, with stair.
  const gallery: Part[] = [];
  const rails: Part[] = [];
  const gy = 7;
  const gz = -Z + 3.2;
  const gx0 = -52;
  const gx1 = 52;
  gallery.push(box(gx1 - gx0, 0.25, 4.4, (gx0 + gx1) / 2, gy, gz));
  for (let x = gx0; x <= gx1 + 0.01; x += 8) {
    gallery.push(box(0.3, gy, 0.3, x, gy / 2, gz + 2));
    gallery.push(box(0.3, 0.5, 4.4, x, gy - 0.35, gz));
  }
  for (let x = gx0; x <= gx1 + 0.01; x += 2)
    rails.push(box(0.06, 1.1, 0.06, x, gy + 0.55, gz + 2.15));
  rails.push(box(gx1 - gx0, 0.08, 0.08, (gx0 + gx1) / 2, gy + 1.1, gz + 2.15));
  rails.push(box(gx1 - gx0, 0.06, 0.06, (gx0 + gx1) / 2, gy + 0.55, gz + 2.15));
  // Stair down from the east end of the gallery.
  const steps = 20;
  for (let i = 0; i < steps; i += 1) {
    gallery.push(box(0.35, 0.08, 1.4, gx1 + 0.8 + i * 0.35, gy - (i + 1) * (gy / steps), gz + 1.3));
  }
  rails.push(strutXY(gz + 2.05, gx1, gy + 1.1, gx1 + steps * 0.35 + 0.8, 1.1, 0.07));

  // Floor markings: walkway along the walls and the outline of the assembly bay.
  const markings: Part[] = [];
  const line = 0.18;
  const lift = 0.012;
  const inset = 5;
  const wx = X - inset;
  const wz = Z - inset;
  markings.push(box(2 * wx, 0.01, line, 0, lift, -wz), box(2 * wx, 0.01, line, 0, lift, wz));
  markings.push(box(line, 0.01, 2 * wz, -wx, lift, 0), box(line, 0.01, 2 * wz, wx, lift, 0));
  const bx = 40;
  const bz = 29;
  markings.push(
    box(2 * bx, 0.01, line * 1.5, 0, lift, -bz),
    box(2 * bx, 0.01, line * 1.5, 0, lift, bz),
  );
  markings.push(
    box(line * 1.5, 0.01, 2 * bz, -bx, lift, 0),
    box(line * 1.5, 0.01, 2 * bz, bx, lift, 0),
  );
  // Hazard hatching in the bay corners.
  const hazard: Part[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 6; i += 1) {
        const g = new BoxGeometry(2.6, 0.01, 0.35)
          .rotateY(Math.PI / 4)
          .translate(sx * (bx - 1.1 - i * 0.7), lift + 0.001, sz * (bz - 1.1 + i * 0.7 * 0));
        hazard.push(g);
      }
    }
  }

  const bySide = (parts: Record<Side, Part[]>) =>
    Object.fromEntries(SIDES.map((s) => [s, merge(parts[s])])) as Record<Side, BufferGeometry>;

  return {
    steelBySide: bySide(steel),
    claddingBySide: bySide(cladding),
    plinthBySide: bySide(plinth),
    windowsBySide: bySide(windows),
    roofSteel: merge(roofSteel),
    roof: merge(roof),
    fixtures: merge(fixtures),
    crane: merge(crane),
    craneSteel: merge(craneSteel),
    gallery: merge(gallery),
    galleryRails: merge(rails),
    markings: merge(markings),
    hazard: merge(hazard),
    door: merge(door),
  };
}

function createMaterials(preset: EnvironmentPreset) {
  const dark = preset.id === "dark-facility";
  const floorMap = concreteTexture(12, dark);
  floorMap.repeat.set((2 * HALL.halfX) / 12, (2 * HALL.halfZ) / 12);
  return {
    steel: new MeshStandardMaterial({ color: "#4f5d6e", metalness: 0.6, roughness: 0.5 }),
    cladding: new MeshStandardMaterial({ color: "#434b55", metalness: 0.25, roughness: 0.8 }),
    plinth: new MeshStandardMaterial({ color: "#5a5d61", metalness: 0, roughness: 0.95 }),
    windows: new MeshStandardMaterial({
      color: "#9fb4c8",
      emissive: "#9fb8d0",
      emissiveIntensity: dark ? 0.03 : 0.45,
      roughness: 0.3,
    }),
    roof: new MeshStandardMaterial({ color: "#1d2228", roughness: 0.95 }),
    fixtures: new MeshStandardMaterial({
      color: "#d8dde2",
      emissive: "#fff6e6",
      emissiveIntensity: preset.light.fixtures,
      roughness: 0.4,
    }),
    crane: new MeshStandardMaterial({ color: "#c79a1e", metalness: 0.35, roughness: 0.5 }),
    craneSteel: new MeshStandardMaterial({ color: "#2b2f35", metalness: 0.8, roughness: 0.35 }),
    gallery: new MeshStandardMaterial({ color: "#3a4048", metalness: 0.5, roughness: 0.7 }),
    rails: new MeshStandardMaterial({ color: "#d1a51f", metalness: 0.3, roughness: 0.55 }),
    markings: new MeshStandardMaterial({ color: "#d4ac2a", roughness: 0.7 }),
    hazard: new MeshStandardMaterial({ color: "#1c1c1c", roughness: 0.7 }),
    door: new MeshStandardMaterial({ color: "#4a525c", metalness: 0.45, roughness: 0.6 }),
    floor: new MeshStandardMaterial({ roughness: 0.62, metalness: 0.05, map: floorMap }),
  };
}

function useMaterials(preset: EnvironmentPreset) {
  const materials = useMemo(() => createMaterials(preset), [preset]);
  useLayoutEffect(
    () => () => {
      materials.floor.map?.dispose();
      for (const m of Object.values(materials)) m.dispose();
    },
    [materials],
  );
  return materials;
}

export function IndustrialHall({ preset }: { preset: EnvironmentPreset }) {
  const geometry = useMemo(() => buildHall(), []);
  useLayoutEffect(
    () => () => {
      for (const value of Object.values(geometry)) {
        if ("dispose" in value) (value as BufferGeometry).dispose();
        else for (const g of Object.values(value as Record<Side, BufferGeometry>)) g.dispose();
      }
    },
    [geometry],
  );
  const m = useMaterials(preset);
  const floor = useMemo(
    () => new PlaneGeometry(2 * HALL.halfX, 2 * HALL.halfZ).rotateX(-Math.PI / 2),
    [],
  );
  useLayoutEffect(() => () => floor.dispose(), [floor]);

  const sides = useRef<Record<Side, Group | null>>({
    north: null,
    south: null,
    east: null,
    west: null,
  });
  const overhead = useRef<Group>(null);

  // Hide whatever stands between the camera and the plant.
  useFrame(({ camera }) => {
    const p = camera.position;
    const margin = 0.5;
    const hide: Record<Side, boolean> = {
      north: p.z < -HALL.halfZ + margin,
      south: p.z > HALL.halfZ - margin,
      west: p.x < -HALL.halfX + margin,
      east: p.x > HALL.halfX - margin,
    };
    for (const side of SIDES) {
      const group = sides.current[side];
      if (group !== null) group.visible = !hide[side];
    }
    if (overhead.current !== null) overhead.current.visible = p.y < HALL.eaveM - 1.5;
  });

  return (
    <group name="industrial-hall">
      <mesh geometry={floor} material={m.floor} receiveShadow />
      <mesh geometry={geometry.markings} material={m.markings} receiveShadow />
      <mesh geometry={geometry.hazard} material={m.hazard} receiveShadow />
      {SIDES.map((side) => (
        <group
          key={side}
          ref={(g) => {
            sides.current[side] = g;
          }}
        >
          <mesh geometry={geometry.steelBySide[side]} material={m.steel} castShadow receiveShadow />
          <mesh geometry={geometry.claddingBySide[side]} material={m.cladding} receiveShadow />
          <mesh geometry={geometry.plinthBySide[side]} material={m.plinth} receiveShadow />
          <mesh geometry={geometry.windowsBySide[side]} material={m.windows} />
          {side === "east" && <mesh geometry={geometry.door} material={m.door} receiveShadow />}
          {side === "north" && (
            <>
              <mesh geometry={geometry.gallery} material={m.gallery} castShadow receiveShadow />
              <mesh geometry={geometry.galleryRails} material={m.rails} castShadow />
            </>
          )}
        </group>
      ))}
      <group ref={overhead}>
        <mesh geometry={geometry.roofSteel} material={m.steel} castShadow />
        <mesh geometry={geometry.roof} material={m.roof} />
        <mesh geometry={geometry.fixtures} material={m.fixtures} />
        <mesh geometry={geometry.crane} material={m.crane} castShadow receiveShadow />
        <mesh geometry={geometry.craneSteel} material={m.craneSteel} castShadow />
      </group>
    </group>
  );
}
