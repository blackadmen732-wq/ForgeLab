import { type BufferGeometry, Vector3, Quaternion } from "three";
import {
  boxGeometry,
  constructionPart,
  constructionRecipeForPart,
  type ComponentGeometry,
  type ConnectionPoint,
} from "@forgelab/sim-core";
import { box, cyl, merge, halfExtents } from "./machineGeometry.js";
import { boltCircle, flangedRing, roundedHousing } from "./industrialGeometry.js";
import type { MachineModel } from "./machines.js";

/** Manufactured stock modules, not manufacturer geometry or a rotor-design calculation.
 * One geometry source serves loose modules and their finished legacy machine.
 */
export function buildPowertrain(
  geometry: ComponentGeometry,
  points: readonly ConnectionPoint[],
  family: "generator" | "steam-turbine",
  part?: string,
): MachineModel {
  const [hx, hy, hz] = halfExtents(geometry);
  const sy = hy / 2,
    sz = hz / 2;
  const radius = 1.5 * Math.min(sy, sz);
  const shellLength = hx * 1.5;
  const main: BufferGeometry[] = [],
    trim: BufferGeometry[] = [],
    accent: BufferGeometry[] = [];
  const include = (key: string) => part === undefined || part === key;
  if (include("base")) {
    for (const z of [-1.35 * sz, 1.35 * sz]) {
      trim.push(box(1.96 * hx, 0.28 * sy, 0.09 * sz, 0, -1.75 * sy, z));
      for (const y of [-1.94 * sy, -1.56 * sy])
        trim.push(box(1.96 * hx, 0.07 * sy, 0.35 * sz, 0, y, z));
      for (const x of [-0.78 * hx, 0.78 * hx]) {
        main.push(roundedHousing([0.5 * sy, 0.12 * sy, 0.6 * sz], [x, -1.92 * sy, z], 0.015 * sy));
        trim.push(cyl(0.055 * sy, 0.08 * sy, "y", [x, -1.8 * sy, z], 6));
      }
    }
    for (const x of [-0.6 * hx, 0.6 * hx])
      trim.push(box(0.16 * sy, 0.25 * sy, 3 * sz, x, -1.72 * sy, 0));
    for (const x of [-0.86 * hx, 0.86 * hx]) {
      trim.push(roundedHousing([0.42 * sy, 0.93 * sy, 0.74 * sz], [x, -1.035 * sy, 0], 0.035 * sy));
      main.push(box(0.6 * sy, 0.09 * sy, 0.9 * sz, x, -0.615 * sy, 0));
    }
  }
  if (include("casing")) {
    main.push(flangedRing(radius * 0.84, radius, shellLength, "x", [0, 0.1 * sy, 0], 48));
    for (const x of [-shellLength / 2, shellLength / 2]) {
      main.push(flangedRing(radius * 0.82, radius * 1.04, 0.1 * sy, "x", [x, 0.1 * sy, 0], 48));
      trim.push(boltCircle(radius * 0.95, 0.032 * sy, 0.04 * sy, 16, "x", [x, 0.1 * sy, 0]));
    }
    // Casing seam and access covers, with the central bore genuinely open.
    for (const z of [-radius, radius]) {
      main.push(box(shellLength, 0.11 * sy, 0.2 * sz, 0, 0.1 * sy, z));
      for (let i = 0; i < 12; i++)
        trim.push(
          cyl(
            0.035 * sy,
            0.14 * sy,
            "y",
            [-shellLength / 2 + ((i + 0.5) * shellLength) / 12, 0.19 * sy, z],
            6,
          ),
        );
    }
    for (const x of [-0.45 * hx, 0.45 * hx]) {
      for (const z of [-0.9 * sz, 0.9 * sz])
        main.push(roundedHousing([0.45 * sy, 0.3 * sy, 0.5 * sz], [x, -1.35 * sy, z], 0.03 * sy));
      trim.push(flangedRing(radius, radius * 1.035, 0.09 * sy, "x", [x, 0.1 * sy, 0], 32));
    }
    const bracketX = family === "generator" ? 0.7 * hx : -0.72 * hx;
    main.push(
      box(
        0.7 * sy,
        0.12 * sy,
        1.1 * sz,
        bracketX,
        family === "generator" ? -0.285 * sy : -0.36 * sy,
        0,
      ),
    );
    // Lift eyes and upper inspection caps stay on the shell when the rotor is removed.
    for (const x of [-0.4 * hx, 0.4 * hx]) {
      trim.push(flangedRing(0.07 * sy, 0.13 * sy, 0.07 * sz, "z", [x, 1.64 * sy, 0], 20));
      main.push(
        roundedHousing([0.55 * sy, 0.09 * sy, 0.5 * sz], [x, 1.6 * sy, 0.5 * sz], 0.02 * sy),
      );
    }
  }
  if (include("rotor")) {
    main.push(cyl(0.19 * sy, hx * 1.98, "x", [0, 0, 0], 32));
    if (family === "generator") {
      main.push(cyl(0.55 * sy, hx * 1.1, "x", [0, 0, 0], 40));
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI * 2) / 12;
        accent.push(
          box(hx * 1.03, 0.11 * sy, 0.18 * sz)
            .rotateX(a)
            .translate(0, Math.cos(a) * 0.61 * sy, Math.sin(a) * 0.61 * sz),
        );
      }
      for (const x of [-0.6 * hx, 0.6 * hx])
        main.push(flangedRing(0.19 * sy, 0.7 * sy, 0.12 * sy, "x", [x, 0, 0], 32));
    } else {
      // Separate bladed stages are visible when the casing is detached.
      for (let stage = 0; stage < 7; stage++) {
        const x = -0.57 * hx + stage * 0.19 * hx;
        const r = (0.63 + stage * 0.065) * Math.min(sy, sz);
        main.push(cyl(r * 0.65, 0.12 * sy, "x", [x, 0, 0], 32));
        for (let i = 0; i < 20; i++) {
          const a = (i * Math.PI * 2) / 20;
          const blade = box(0.1 * sy, r * 0.34, 0.055 * sz)
            .rotateY(0.28)
            .rotateX(a)
            .translate(x, Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
          accent.push(blade);
        }
      }
    }
    for (const x of [-0.86 * hx, 0.86 * hx]) {
      trim.push(flangedRing(0.2 * sy, 0.48 * sy, 0.32 * sy, "x", [x, 0, 0], 32));
      trim.push(roundedHousing([0.38 * sy, 0.18 * sy, 0.72 * sz], [x, -0.48 * sy, 0], 0.02 * sy));
    }
    // Coupling flanges have real open shaft bores and a readable bolt circle.
    const x = (family === "generator" ? -1 : 1) * hx * 0.96;
    main.push(flangedRing(0.19 * sy, 0.34 * sy, 0.1 * sy, "x", [x, 0, 0], 32));
  }
  if (include("terminals") && family === "generator") {
    main.push(roundedHousing([0.8 * sy, 1.25 * sy, 1.1 * sz], [hx * 0.77, 0.4 * sy, 0], 0.05 * sy));
    accent.push(box(0.03 * sy, 0.95 * sy, 0.88 * sz, hx * 0.91, 0.4 * sy, 0));
    trim.push(cyl(0.08 * sy, 0.35 * sy, "x", [hx * 0.95, 0, 0], 20));
    for (const z of [-0.35 * sz, 0, 0.35 * sz])
      trim.push(cyl(0.065 * sy, 0.3 * sy, "y", [hx * 0.77, 1.14 * sy, z], 16));
  }
  if (include("chest") && family === "steam-turbine") {
    main.push(
      roundedHousing([0.45 * hx, 1.4 * sy, 1.7 * sz], [-0.72 * hx, 0.35 * sy, 0], 0.12 * sy),
    );
    trim.push(cyl(0.11 * sy, 0.5 * sy, "y", [-0.72 * hx, 1.25 * sy, 0], 16));
    accent.push(flangedRing(0.04 * sy, 0.28 * sy, 0.04 * sy, "y", [-0.72 * hx, 1.5 * sy, 0], 24));
  }
  for (const p of points) {
    if (p.connectionType === "steam") {
      const r = p.port?.domain === "fluid" ? p.port.innerDiameterM / 2 : 0.25;
      const fitting = flangedRing(r, r + 0.12 * sy, 0.14 * sy, "y", [0, 0, 0], 32);
      fitting.applyQuaternion(
        new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          new Vector3(p.localDirection.x, p.localDirection.y, p.localDirection.z),
        ),
      );
      fitting.translate(p.localPosition.x, p.localPosition.y, p.localPosition.z);
      trim.push(fitting);
    }
  }
  return {
    main: merge(main),
    trim: merge(trim),
    accent: merge(accent),
    accentColor: family === "generator" ? "#b87948" : "#a9aeb3",
    replacesEnvelope: true,
    rotating: part === "rotor",
  };
}

export function powertrainPartModel(
  type: string,
  points: readonly ConnectionPoint[],
): MachineModel | null {
  const recipe = constructionRecipeForPart(type),
    part = constructionPart(type);
  if (!recipe || !part || recipe.resultType === "coolant-pump") return null;
  const fullPoints = points.map((p) => ({
    ...p,
    localPosition: {
      x: p.localPosition.x + part.offset.x,
      y: p.localPosition.y + part.offset.y,
      z: p.localPosition.z + part.offset.z,
    },
  }));
  const model = buildPowertrain(
    boxGeometry(recipe.size, recipe.thicknessM),
    fullPoints,
    recipe.resultType as "generator" | "steam-turbine",
    part.key,
  );
  for (const g of [model.main, model.trim, model.accent])
    g?.translate(-part.offset.x, -part.offset.y, -part.offset.z);
  return model;
}
