import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  type ArcGeometry,
  type ComponentGeometry,
  type ConnectionPoint,
  arcFrame,
  geometryLocalHalfExtentsM,
} from "@forgelab/sim-core";

/**
 * Finished machine models. Presentation only: each is drawn inside (or just around) the
 * part's physics envelope and scales with its dimensions; the solver sees only the
 * envelope. Three surfaces per machine:
 *
 *  - main   — the shell, drawn with the part's own material so overlays colour it;
 *  - trim   — dark steel: skids, flanges, pedestals, fins, frames;
 *  - accent — paint and fittings that identify the machine (motor paint, bushings...).
 *
 * `replacesEnvelope` means the envelope itself is not drawn (it stays as the pick volume).
 */
export interface MachineModel {
  readonly main: BufferGeometry | null;
  readonly trim: BufferGeometry | null;
  readonly accent: BufferGeometry | null;
  readonly accentColor: string;
  readonly replacesEnvelope: boolean;
}

export type V = readonly [number, number, number];
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export function box(sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): BufferGeometry {
  return new BoxGeometry(Math.max(sx, 1e-3), Math.max(sy, 1e-3), Math.max(sz, 1e-3)).translate(
    x,
    y,
    z,
  );
}

/** Cylinder of radius r and length l along `axis`, centred at c. */
export function cyl(
  r: number,
  l: number,
  axis: "x" | "y" | "z",
  c: V = [0, 0, 0],
  segments = 24,
  r2 = r,
): BufferGeometry {
  const g = new CylinderGeometry(r2, r, Math.max(l, 1e-3), segments);
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  return g.translate(c[0], c[1], c[2]);
}

export function ring(
  R: number,
  tube: number,
  axis: "x" | "y" | "z",
  c: V = [0, 0, 0],
): BufferGeometry {
  const g = new TorusGeometry(R, tube, 6, 32);
  if (axis === "y") g.rotateX(Math.PI / 2);
  if (axis === "x") g.rotateY(Math.PI / 2);
  return g.translate(c[0], c[1], c[2]);
}

/** Along `dir` from `at`: a short nozzle of radius r and length l, flanged at its end. */
function nozzle(
  at: V,
  dir: V,
  r: number,
  l: number,
): { pipe: BufferGeometry; flange: BufferGeometry } {
  const d = new Vector3(...dir).normalize();
  const q = new Quaternion().setFromUnitVectors(Y, d);
  const mid = new Vector3(...at).addScaledVector(d, -l / 2);
  const end = new Vector3(...at).addScaledVector(d, -Math.min(0.05, l / 4));
  const place = (g: BufferGeometry, p: Vector3) =>
    g.applyMatrix4(new Matrix4().compose(p, q, new Vector3(1, 1, 1)));
  return {
    pipe: place(new CylinderGeometry(r, r, l, 16), mid),
    flange: place(new CylinderGeometry(r * 1.45, r * 1.45, Math.max(0.05, r * 0.3), 16), end),
  };
}

export function merge(parts: BufferGeometry[]): BufferGeometry | null {
  const indexed = parts.map((p) => (p.index === null ? p : p.toNonIndexed()));
  const merged = indexed.length === 0 ? null : mergeGeometries(indexed, false);
  for (const p of [...parts, ...indexed]) p.dispose();
  return merged;
}

export function halfExtents(g: ComponentGeometry): V {
  switch (g.kind) {
    case "box":
      return [g.sizeM.x / 2, g.sizeM.y / 2, g.sizeM.z / 2];
    case "cylinder": {
      const r = g.radiusM;
      const h = g.heightM / 2;
      return g.axis === "x" ? [h, r, r] : g.axis === "z" ? [r, r, h] : [r, h, r];
    }
    case "torus": {
      const R = g.majorRadiusM + g.minorRadiusM;
      const a = g.minorRadiusM;
      return g.axis === "x" ? [a, R, R] : g.axis === "z" ? [R, R, a] : [R, a, R];
    }
    case "arc": {
      const h = geometryLocalHalfExtentsM(g);
      return [h.x, h.y, h.z];
    }
  }
}

/**
 * A bent tube along an arc part's centreline (sim-core `arcFrame`): three's torus sector,
 * swept symmetrically about the origin and carried into the part's radial / tangent / axis
 * frame. `tubeRadius` lets callers draw the bore or an inner band.
 */
export function arcTube(
  g: ArcGeometry,
  tubeRadius: number,
  radialSegments = 24,
  tubularSegments = 48,
): BufferGeometry {
  const tube = new TorusGeometry(
    g.bendRadiusM,
    tubeRadius,
    radialSegments,
    tubularSegments,
    g.sweepRad,
  );
  // Native: centre of curvature at the origin, sweep from +x towards +y about +z.
  tube.rotateZ(-g.sweepRad / 2);
  tube.translate(-g.bendRadiusM, 0, 0);
  const f = arcFrame(g);
  const basis = new Matrix4().makeBasis(
    new Vector3(f.radial.x, f.radial.y, f.radial.z),
    new Vector3(f.tangent.x, f.tangent.y, f.tangent.z),
    new Vector3(f.axis.x, f.axis.y, f.axis.z),
  );
  return tube.applyMatrix4(basis);
}

/* ------------------------------------------------------------------------------------ *
 * Service fittings, on every machine
 * ------------------------------------------------------------------------------------ */

/**
 * A nozzle and flange at each pipe or duct port, a junction box at each power port,
 * a gland at each signal port. These are where the routed services visibly attach.
 */
function fittings(
  points: readonly ConnectionPoint[],
  scale: number,
  trim: BufferGeometry[],
  accent: BufferGeometry[],
): void {
  for (const p of points) {
    const at: V = [p.localPosition.x, p.localPosition.y, p.localPosition.z];
    const dir: V = [p.localDirection.x, p.localDirection.y, p.localDirection.z];
    if (p.port?.domain === "vacuum" && p.port.opening === "chamber-end") {
      // A chamber segment's end flange: a bolted collar round the bore, flush with the end.
      const d = new Vector3(...dir).normalize();
      const q = new Quaternion().setFromUnitVectors(Z, d);
      const r = p.port.flangeDiameterM / 2;
      const collar = new TorusGeometry(r + 0.09, 0.06, 8, 48).applyMatrix4(
        new Matrix4().compose(
          new Vector3(...at).addScaledVector(d, -0.06),
          q,
          new Vector3(1, 1, 0.8),
        ),
      );
      trim.push(collar);
      continue;
    }
    const bore =
      p.port?.domain === "fluid"
        ? p.port.innerDiameterM / 2 + 0.03
        : p.port?.domain === "vacuum"
          ? p.port.flangeDiameterM / 2 + 0.03
          : 0;
    switch (p.connectionType) {
      case "coolant":
      case "steam":
      case "cryo":
      case "vacuum": {
        const r = Math.min(Math.max(bore || 0.15, 0.08), 0.6, scale * 0.35);
        const n = nozzle(at, dir, r, Math.min(0.6, r * 2.2));
        trim.push(n.pipe, n.flange);
        break;
      }
      case "fuel": {
        const n = nozzle(at, dir, 0.05, 0.25);
        trim.push(n.pipe, n.flange);
        break;
      }
      case "port": {
        const r = Math.min(0.45, scale * 0.3);
        const n = nozzle(at, dir, r, Math.min(0.8, r * 2));
        trim.push(n.pipe, n.flange);
        break;
      }
      case "electrical": {
        // Terminal box.
        const d = new Vector3(...dir);
        const s = Math.min(0.45, Math.max(0.18, scale * 0.18));
        const c = new Vector3(...at).addScaledVector(d, -s * 0.35);
        accent.push(box(s, s * 0.8, s, c.x, c.y, c.z));
        break;
      }
      case "control": {
        const n = nozzle(at, dir, 0.035, 0.12);
        trim.push(n.pipe);
        break;
      }
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------------------------------ *
 * Machines
 * ------------------------------------------------------------------------------------ */

type Builder = (
  h: V,
  main: BufferGeometry[],
  trim: BufferGeometry[],
  accent: BufferGeometry[],
) => {
  accentColor: string;
  replacesEnvelope: boolean;
};

const BUILDERS: Readonly<Record<string, Builder>> = {
  "shield-block": ([hx, hy, hz], main, trim, accent) => {
    // Forged block (front +Z faces the plasma): radial slots cut into the front, two
    // diagonal relief grooves, a central-bolt boss, four stub-key pads and coolant stubs
    // on the back. Schematic detail on the true envelope.
    main.push(box(2 * hx, 2 * hy, 2 * hz * 0.94, 0, 0, -hz * 0.06));
    const slots = Math.max(3, Math.round((2 * hx) / 0.25));
    for (let i = 1; i < slots; i += 1) {
      const x = -hx + (2 * hx * i) / slots;
      if (Math.abs(x) < 0.12) continue;
      trim.push(box(0.02, 2 * hy * 0.8, 0.012, x, 0, hz * 0.88));
    }
    for (const s of [-1, 1]) {
      const g = box(0.05, Math.hypot(hx, hy) * 1.6, 0.02, 0, 0, -hz * 0.06);
      g.rotateZ(s * Math.atan2(hx, hy));
      g.translate(0, 0, -hz * 0.94 + 0.01);
      trim.push(g);
    }
    accent.push(cyl(0.11, 0.06, "z", [0, 0, hz * 0.91]));
    trim.push(ring(0.11, 0.015, "z", [0, 0, hz * 0.95]));
    for (const [x, y] of [
      [-0.6, 0.6],
      [0.6, 0.6],
      [-0.6, -0.6],
      [0.6, -0.6],
    ] as const)
      accent.push(box(0.18, 0.1, 0.08, x * hx, y * hy, -hz - 0.03));
    for (const x of [-hx / 2, hx / 2]) trim.push(cyl(0.04, 0.12, "y", [x, -hy - 0.04, -hz / 2]));
    return { accentColor: "#7c8a99", replacesEnvelope: true };
  },
  "first-wall-panel": ([hx, hy, hz], main, trim, accent) => {
    // Beryllium tiles (about 50 mm, small gaps) on a copper-alloy heat sink on a steel
    // backing plate, with the central-bolt hole. Schematic detail on the true envelope.
    const back = hz * 0.8;
    const sink = hz * 0.6;
    const tilesT = 2 * hz - back - sink;
    main.push(box(2 * hx, 2 * hy, back, 0, 0, -hz + back / 2));
    accent.push(box(2 * hx * 0.99, 2 * hy * 0.99, sink, 0, 0, -hz + back + sink / 2));
    const tile = 0.05;
    const nx = Math.max(2, Math.floor((2 * hx) / tile));
    const ny = Math.max(2, Math.floor((2 * hy) / tile));
    const wx = (2 * hx) / nx;
    const wy = (2 * hy) / ny;
    const z = hz - tilesT / 2;
    for (let i = 0; i < nx; i += 1)
      for (let j = 0; j < ny; j += 1) {
        const x = -hx + wx * (i + 0.5);
        const y = -hy + wy * (j + 0.5);
        if (Math.hypot(x, y) < 0.09) continue;
        main.push(box(wx * 0.9, wy * 0.9, tilesT, x, y, z));
      }
    trim.push(ring(0.06, 0.012, "z", [0, 0, hz]));
    return { accentColor: "#b0683c", replacesEnvelope: true };
  },
  cryostat: ([r, hy], main, trim) => {
    // Shell with stiffening rings every ~3 m, vertical ribs, lid and base flanges.
    main.push(cyl(r, 2 * hy, "y", [0, 0, 0], 96));
    const rings = Math.max(2, Math.round((2 * hy) / 3));
    for (let i = 1; i < rings; i += 1)
      trim.push(ring(r + 0.06, 0.09, "y", [0, -hy + (2 * hy * i) / rings, 0]));
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      trim.push(
        box(0.12, 2 * hy * 0.96, 0.35, Math.cos(a) * (r + 0.1), 0, Math.sin(a) * (r + 0.1)),
      );
    }
    for (const s of [-1, 1]) trim.push(cyl(r + 0.35, 0.3, "y", [0, s * (hy - 0.15), 0], 96));
    return { accentColor: "#9aa3ad", replacesEnvelope: true };
  },
  "stair-tower": ([hx, hy, hz], main, trim, accent) => {
    // Switchback flights 3.6 m high between landings; stringers, treads, posts, rails.
    const RISE = 3.6;
    const flights = Math.max(1, Math.ceil((2 * hy) / RISE));
    const rise = (2 * hy) / flights;
    const landing = Math.min(1.2, hz * 0.3);
    const run = 2 * hz - 2 * landing;
    const width = hx - 0.1;
    for (let k = 0; k < flights; k += 1) {
      const x = (k % 2 === 0 ? -1 : 1) * (hx / 2);
      const dir = k % 2 === 0 ? 1 : -1;
      const y0 = -hy + k * rise;
      const steps = Math.max(4, Math.round(rise / 0.18));
      for (let j = 0; j < steps; j += 1) {
        const z = dir * (-run / 2 + ((j + 0.5) * run) / steps);
        main.push(box(width, 0.04, run / steps, x, y0 + ((j + 1) * rise) / steps, z));
      }
      // Stringers and a handrail along the flight.
      const len = Math.hypot(run, rise);
      const slope = Math.atan2(rise, run) * dir;
      for (const side of [-1, 1]) {
        const g = box(0.06, 0.25, len, x + side * (width / 2), y0 + rise / 2, 0);
        g.translate(-(x + side * (width / 2)), -(y0 + rise / 2), 0);
        g.rotateX(-slope);
        g.translate(x + side * (width / 2), y0 + rise / 2, 0);
        main.push(g);
        const rail = box(0.04, 0.04, len, 0, 0, 0).rotateX(-slope);
        // Handrail 0.9 m above the treads.
        rail.translate(x + side * (width / 2), y0 + rise / 2 + 0.9, 0);
        trim.push(rail);
      }
      // Landing at the top of the flight.
      const zl = dir * (hz - landing / 2);
      accent.push(box(2 * hx, 0.06, landing, 0, y0 + rise, zl));
    }
    // Corner posts.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) trim.push(box(0.12, 2 * hy, 0.12, sx * hx, 0, sz * hz));
    return { accentColor: "#e0b22b", replacesEnvelope: true };
  },
  "coolant-pump": ([hx, hy, hz], main, trim, accent) => {
    // Vertical in-line pump: skid, volute casing with suction/discharge, coupling, finned motor.
    trim.push(box(2 * hx, 0.12 * hy, 2 * hz * 0.9, 0, -hy + 0.06 * hy, 0));
    const casingR = 0.52 * Math.min(hx, hz);
    main.push(cyl(casingR, 0.55 * hy, "y", [0, -0.55 * hy, 0], 28));
    main.push(cyl(0.3 * hy, 2 * hx * 0.95, "x", [0, -0.55 * hy, 0], 20));
    trim.push(ring(casingR * 1.02, 0.03 * hy, "y", [0, -0.28 * hy, 0]));
    trim.push(cyl(0.18 * hx, 0.25 * hy, "y", [0, -0.12 * hy, 0], 16)); // coupling guard
    accent.push(cyl(0.4 * Math.min(hx, hz), 0.95 * hy, "y", [0, 0.45 * hy, 0], 28)); // motor
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      const r = 0.42 * Math.min(hx, hz);
      trim.push(
        box(0.09 * hx, 0.8 * hy, 0.03 * hz)
          .rotateY(-a)
          .translate(Math.cos(a) * r, 0.45 * hy, Math.sin(a) * r),
      );
    }
    trim.push(cyl(0.43 * Math.min(hx, hz), 0.06 * hy, "y", [0, 0.94 * hy, 0], 28));
    return { accentColor: "#35698c", replacesEnvelope: true };
  },
  "steam-generator": ([hx, hy], main, trim) => {
    // Vertical shell-and-tube: shell, elliptical heads, skirt, girth welds, manway.
    const r = hx;
    const head = 0.45 * r;
    main.push(cyl(r, 2 * hy - 2 * head, "y", [0, 0, 0], 40));
    main.push(
      new SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(1, head / r, 1)
        .translate(0, hy - head, 0),
    );
    main.push(
      new SphereGeometry(r, 40, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
        .scale(1, head / r, 1)
        .translate(0, -hy + head, 0),
    );
    trim.push(cyl(r * 0.92, head * 1.2, "y", [0, -hy + head * 0.6, 0], 40)); // skirt
    for (const y of [-0.5, 0, 0.5]) trim.push(ring(r * 1.005, 0.025, "y", [0, y * hy, 0]));
    trim.push(
      cyl(0.28, 0.2, "z", [0, 0.2 * hy, r], 20),
      cyl(0.34, 0.06, "z", [0, 0.2 * hy, r + 0.1], 20),
    );
    return { accentColor: "#8a939e", replacesEnvelope: true };
  },
  "steam-turbine": ([hx, hy, hz], main, trim, accent) => {
    const r = 0.8 * Math.min(hy, hz);
    trim.push(box(2 * hx, 0.25 * hy, 2 * hz * 0.9, 0, -hy + 0.125 * hy, 0)); // plinth
    main.push(cyl(r, 1.5 * hx, "x", [0, 0, 0], 36, r * 0.82)); // casing, larger at the exhaust
    trim.push(box(1.5 * hx, 0.08 * hy, 2 * r * 1.12, 0, 0, 0)); // horizontal split flange
    for (const s of [-1, 1])
      trim.push(box(0.35 * hx, 1.3 * hy, 0.8 * hz, s * 0.85 * hx, -0.35 * hy, 0)); // pedestals
    trim.push(cyl(0.12 * hy, 1.95 * hx, "x", [0, 0, 0], 16)); // shaft line
    accent.push(box(0.35 * hx, 0.45 * hy, 0.6 * hz, -0.55 * hx, r * 0.95, 0)); // steam chest
    trim.push(cyl(0.16 * hy, 1.1 * hx, "x", [0, r + 0.35 * hy, 0.3 * hz], 16)); // crossover
    for (const x of [-0.45, 0.45])
      trim.push(cyl(0.12 * hy, 0.4 * hy, "y", [x * hx, r + 0.15 * hy, 0.3 * hz], 12));
    return { accentColor: "#b0754a", replacesEnvelope: true };
  },
  generator: ([hx, hy, hz], main, trim, accent) => {
    const r = 0.8 * Math.min(hy, hz);
    trim.push(box(2 * hx, 0.2 * hy, 2 * hz * 0.85, 0, -hy + 0.1 * hy, 0));
    main.push(cyl(r, 1.5 * hx, "x", [0, 0.05 * hy, 0], 36));
    const n = Math.max(3, Math.round((1.5 * hx) / 0.7));
    for (let i = 0; i <= n; i += 1)
      trim.push(ring(r * 1.01, 0.05, "x", [-0.75 * hx + (1.5 * hx * i) / n, 0.05 * hy, 0]));
    for (const s of [-1, 1])
      trim.push(box(0.3 * hx, 0.6 * hy, 1.6 * hz, s * 0.6 * hx, -0.6 * hy, 0)); // feet
    accent.push(cyl(0.45 * r, 0.3 * hx, "x", [0.88 * hx, 0.05 * hy, 0], 24)); // exciter
    accent.push(box(0.4 * hx, 0.3 * hy, 0.5 * hz, 0, r + 0.2 * hy, 0)); // terminal box
    return { accentColor: "#51705a", replacesEnvelope: true };
  },
  "grid-connection": ([hx, hy, hz], main, trim, accent) => {
    // Step-down transformer: tank, radiator banks, conservator, three bushings.
    main.push(box(1.3 * hx, 1.3 * hy, 1.2 * hz, -0.1 * hx, -0.3 * hy, 0));
    for (const s of [-1, 1])
      for (let i = 0; i < 7; i += 1)
        trim.push(
          box(0.9 * hx * 0.12, 1.1 * hy, 0.04, -0.7 * hx + i * 0.2 * hx, -0.35 * hy, s * 0.72 * hz),
        );
    trim.push(cyl(0.22 * hy, 1.1 * hx, "x", [-0.1 * hx, 0.62 * hy, -0.45 * hz], 20)); // conservator
    for (let i = 0; i < 3; i += 1) {
      const x = -0.55 * hx + i * 0.45 * hx;
      accent.push(cyl(0.08 * hx, 0.55 * hy, "y", [x, 0.62 * hy, 0.2 * hz], 12, 0.05 * hx));
      for (let k = 0; k < 4; k += 1)
        accent.push(cyl(0.12 * hx, 0.03, "y", [x, 0.45 * hy + k * 0.1 * hy, 0.2 * hz], 12));
    }
    return { accentColor: "#c9c1ae", replacesEnvelope: true };
  },
  "neutral-beam": ([hx, hy, hz], main, trim, accent) => {
    // Ion source, neutraliser, bending-magnet housing, drift duct to the vessel port.
    trim.push(box(2 * hx, 0.12 * hy, 2 * hz * 0.7, 0, -hy + 0.06 * hy, 0));
    accent.push(cyl(0.75 * Math.min(hy, hz), 0.45 * hx, "x", [-0.72 * hx, 0.05 * hy, 0], 28)); // source can
    main.push(box(0.75 * hx, 1.4 * hy, 1.4 * hz, -0.15 * hx, 0.05 * hy, 0)); // neutraliser tank
    trim.push(box(0.35 * hx, 1.6 * hy, 1.6 * hz, 0.35 * hx, 0.05 * hy, 0)); // magnet yoke
    main.push(
      cyl(
        0.35 * Math.min(hy, hz),
        0.5 * hx,
        "x",
        [0.75 * hx, 0.05 * hy, 0],
        20,
        0.25 * Math.min(hy, hz),
      ),
    );
    for (const x of [-0.6, 0, 0.6])
      trim.push(
        box(0.1 * hx, 0.9 * hy, 0.1 * hz, x * hx, -0.5 * hy, 0.6 * hz),
        box(0.1 * hx, 0.9 * hy, 0.1 * hz, x * hx, -0.5 * hy, -0.6 * hz),
      );
    return { accentColor: "#8e6fb3", replacesEnvelope: true };
  },
  "fuel-injector": ([hx, hy, hz], main, trim, accent) => {
    main.push(box(1.1 * hx, 2 * hy * 0.95, 2 * hz * 0.9, -0.4 * hx, 0, 0)); // cabinet
    trim.push(box(0.02, 1.6 * hy, 1.6 * hz, 0.15 * hx + 0.01, 0, 0));
    for (let i = 0; i < 3; i += 1)
      accent.push(cyl(0.12 * hz, 1.3 * hy, "y", [0.45 * hx, -0.2 * hy, (-0.5 + i * 0.5) * hz], 14)); // D and T bottles
    trim.push(cyl(0.08 * hy, 0.9 * hx, "x", [0.45 * hx, 0.55 * hy, 0], 12)); // pellet barrel
    return { accentColor: "#3f8a5a", replacesEnvelope: true };
  },
  "vacuum-pump": ([hx, hy], main, trim, accent) => {
    // Cryopump: vessel, top flange, gate valve, cold head on the side.
    main.push(cyl(hx * 0.85, 1.5 * hy, "y", [0, -0.2 * hy, 0], 32));
    trim.push(cyl(hx, 0.12 * hy, "y", [0, 0.62 * hy, 0], 32));
    trim.push(box(1.5 * hx, 0.25 * hy, 1.5 * hx, 0, 0.8 * hy, 0)); // gate valve
    accent.push(cyl(0.2 * hx, 0.8 * hy, "y", [0.95 * hx, -0.1 * hy, 0], 16)); // cold head
    trim.push(cyl(0.9 * hx, 0.06 * hy, "y", [0, -0.95 * hy, 0], 32));
    return { accentColor: "#c7ccd2", replacesEnvelope: true };
  },
  breaker: ([hx, hy, hz], main, trim, accent) => {
    main.push(box(2 * hx, 2 * hy, 2 * hz));
    for (const y of [-0.45, 0.2]) trim.push(box(1.7 * hx, 0.6 * hy, 0.02, 0, y * hy, hz + 0.01)); // door panels
    accent.push(box(0.35 * hx, 0.2 * hy, 0.03, 0.4 * hx, 0.72 * hy, hz + 0.02)); // status window
    trim.push(box(0.06, 0.25 * hy, 0.05, 0.7 * hx, 0, hz + 0.03)); // handle
    return { accentColor: "#e0a92b", replacesEnvelope: true };
  },
  interlock: ([hx, hy, hz], main, trim, accent) => {
    main.push(box(2 * hx, 2 * hy, 2 * hz));
    accent.push(box(1.3 * hx, 0.45 * hy, 0.03, 0, 0.35 * hy, hz + 0.015)); // screen
    for (let i = 0; i < 4; i += 1)
      trim.push(cyl(0.05, 0.04, "z", [(-0.45 + i * 0.3) * hx, -0.1 * hy, hz + 0.02], 12));
    trim.push(box(2 * hx * 1.02, 0.08, 2 * hz * 1.02, 0, hy - 0.04, 0));
    return { accentColor: "#1f5a7a", replacesEnvelope: true };
  },
  "reactor-chamber": ([hx, hy], main, trim) => {
    const r = hx;
    main.push(cyl(r, 2 * hy * 0.9, "y", [0, 0, 0], 40));
    for (const s of [-1, 1]) trim.push(cyl(r * 1.08, 0.08 * hy, "y", [0, s * 0.9 * hy, 0], 40));
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      trim.push(box(0.1, 0.3 * hy, 0.1, Math.cos(a) * r * 1.02, -0.6 * hy, Math.sin(a) * r * 1.02));
    }
    return { accentColor: "#8a939e", replacesEnvelope: true };
  },
};

/** The finished model for a part, or null when its envelope is drawn as is. */
export function machineModel(
  type: string,
  geometry: ComponentGeometry,
  points: readonly ConnectionPoint[],
): MachineModel | null {
  const h = halfExtents(geometry);
  const main: BufferGeometry[] = [];
  const trim: BufferGeometry[] = [];
  const accent: BufferGeometry[] = [];
  const builder = BUILDERS[type];
  const style = builder?.(h, main, trim, accent) ?? {
    accentColor: "#8a939e",
    replacesEnvelope: false,
  };
  fittings(points, Math.min(h[0], h[1], h[2]) * 2, trim, accent);
  if (main.length === 0 && trim.length === 0 && accent.length === 0) return null;
  return {
    main: merge(main),
    trim: merge(trim),
    accent: merge(accent),
    accentColor: style.accentColor,
    replacesEnvelope: style.replacesEnvelope && main.length > 0,
  };
}
