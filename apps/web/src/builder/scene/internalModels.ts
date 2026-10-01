import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  LatheGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from "three";
import type { ProductInternal } from "@forgelab/reactor-components";
import type { ComponentGeometry } from "@forgelab/sim-core";
import { box, cyl, halfExtents, merge, ring, type V } from "./machines.js";

/**
 * What is inside each finished machine, as geometry: one mesh per internal region of its
 * product sheet, in the part's local frame (the same frame as its machine model).
 *
 * SCHEMATIC. Arrangement and proportions are representative of the machine type — a
 * pump's impeller sits in its volute on a shaft from the motor — not a manufacturer's
 * design. Parts without a bespoke model show their regions as nested bands, outermost
 * first, sized by volume when every region has a volume fraction and in equal steps
 * otherwise. The cutaway view says so.
 */
export type RegionGeometry = ReadonlyMap<string, BufferGeometry>;

type Parts = Record<string, BufferGeometry[]>;
type Builder = (h: V) => Parts;

/** Open-ended thin cylinder (a shell) along `axis`. */
function shell(r: number, l: number, axis: "x" | "y" | "z", c: V = [0, 0, 0]): BufferGeometry {
  const g = new CylinderGeometry(r, r, Math.max(l, 1e-3), 40, 1, true);
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  return g.translate(c[0], c[1], c[2]);
}

/** A thick ring (closed annulus) of radii ri..ro and length l along `axis`. */
function annulus(
  ri: number,
  ro: number,
  l: number,
  axis: "x" | "y" | "z",
  c: V = [0, 0, 0],
): BufferGeometry {
  const h = Math.max(l, 1e-3) / 2;
  const g = new LatheGeometry(
    [
      new Vector2(ri, -h),
      new Vector2(ro, -h),
      new Vector2(ro, h),
      new Vector2(ri, h),
      new Vector2(ri, -h),
    ],
    40,
  );
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  return g.translate(c[0], c[1], c[2]);
}

/** Thin-walled open box (four walls and a floor). */
function tankWalls(sx: number, sy: number, sz: number, c: V, t: number): BufferGeometry[] {
  const [x, y, z] = c;
  return [
    box(sx, sy, t, x, y, z - sz / 2),
    box(sx, sy, t, x, y, z + sz / 2),
    box(t, sy, sz, x - sx / 2, y, z),
    box(t, sy, sz, x + sx / 2, y, z),
    box(sx, t, sz, x, y - sy / 2, z),
  ];
}

const BUILDERS: Readonly<Record<string, Builder>> = {
  "coolant-pump": ([hx, hy, hz]) => {
    const m = Math.min(hx, hz);
    const casingR = 0.52 * m;
    const yc = -0.55 * hy;
    const blades: BufferGeometry[] = [];
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      blades.push(
        box(0.55 * casingR, 0.16 * hy, 0.025 * m)
          .translate(0.3 * casingR, 0, 0)
          .rotateY(a)
          .translate(0, yc, 0),
      );
    }
    const windings: BufferGeometry[] = [];
    for (let i = 0; i < 7; i += 1)
      windings.push(ring(0.31 * m, 0.035 * m, "y", [0, (0.12 + i * 0.1) * hy, 0]));
    return {
      casing: [shell(casingR * 0.99, 0.55 * hy, "y", [0, yc, 0])],
      coolant: [cyl(casingR * 0.93, 0.5 * hy, "y", [0, yc, 0], 32)],
      impeller: [cyl(0.62 * casingR, 0.04 * hy, "y", [0, yc - 0.09 * hy, 0], 32), ...blades],
      shaft: [cyl(0.05 * m, 1.45 * hy, "y", [0, 0.175 * hy, 0], 16)],
      seal: [annulus(0.055 * m, 0.13 * m, 0.06 * hy, "y", [0, -0.27 * hy, 0])],
      bearings: [
        ring(0.085 * m, 0.03 * m, "y", [0, -0.1 * hy, 0]),
        ring(0.085 * m, 0.03 * m, "y", [0, 0.85 * hy, 0]),
      ],
      "motor-winding": windings,
      "motor-insulation": [shell(0.36 * m, 0.78 * hy, "y", [0, 0.45 * hy, 0])],
      drive: [box(0.22 * hx, 0.3 * hy, 0.18 * hz, 0.62 * hx, 0.35 * hy, 0)],
    };
  },
  "steam-generator": ([hx, hy]) => {
    const r = hx;
    const head = 0.45 * r;
    const sheetY = -hy + head * 1.45;
    const top = 0.45 * hy;
    const tubes: BufferGeometry[] = [];
    for (const [radius, count] of [
      [0.32, 8],
      [0.62, 14],
    ] as const)
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2;
        tubes.push(
          cyl(
            0.025 * r,
            top - sheetY,
            "y",
            [Math.cos(a) * radius * r, (top + sheetY) / 2, Math.sin(a) * radius * r],
            8,
          ),
        );
      }
    for (const radius of [0.32, 0.62]) tubes.push(ring(radius * r, 0.025 * r, "y", [0, top, 0]));
    const separators: BufferGeometry[] = [];
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      separators.push(
        cyl(
          0.12 * r,
          0.25 * hy,
          "y",
          [Math.cos(a) * 0.5 * r, 0.68 * hy, Math.sin(a) * 0.5 * r],
          16,
        ),
      );
    }
    const waterTop = 0.3 * hy;
    return {
      shell: [shell(r * 0.99, 2 * hy - 2 * head, "y")],
      secondary: [cyl(r * 0.95, waterTop - sheetY, "y", [0, (waterTop + sheetY) / 2, 0], 36)],
      tubes,
      primary: [
        new SphereGeometry(r * 0.94, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
          .scale(1, head / r, 1)
          .translate(0, -hy + head, 0),
      ],
      tubesheet: [cyl(r * 0.97, 0.08 * hy, "y", [0, sheetY, 0], 36)],
      separators,
    };
  },
  "steam-turbine": ([hx, hy, hz]) => {
    const r = 0.8 * Math.min(hy, hz);
    const discs: BufferGeometry[] = [];
    for (let i = 0; i < 7; i += 1) {
      const x = (-0.6 + (1.2 * i) / 6) * hx;
      const radius = (0.45 + (0.4 * i) / 6) * r;
      discs.push(cyl(radius, 0.035 * hx, "x", [x, 0, 0], 32));
      // Blades as a fringe of thin plates around each disc.
      for (let k = 0; k < 18; k += 1) {
        const a = (k / 18) * Math.PI * 2;
        discs.push(
          new BoxGeometry(0.03 * hx, 0.18 * r, 0.035 * r)
            .translate(0, radius + 0.08 * r, 0)
            .rotateX(a)
            .translate(x, 0, 0),
        );
      }
    }
    return {
      casing: [shell(r * 0.98, 1.5 * hx, "x")],
      steam: [cyl(r * 0.92, 1.45 * hx, "x", [0, 0, 0], 32)],
      blades: discs,
      rotor: [cyl(0.25 * r, 1.7 * hx, "x", [0, 0, 0], 20)],
      bearings: [
        ring(0.28 * r, 0.05 * r, "x", [-0.86 * hx, 0, 0]),
        ring(0.28 * r, 0.05 * r, "x", [0.86 * hx, 0, 0]),
      ],
    };
  },
  generator: ([hx, hy, hz]) => {
    const r = 0.8 * Math.min(hy, hz);
    const c: V = [0, 0.05 * hy, 0];
    const bars: BufferGeometry[] = [];
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      bars.push(
        box(1.45 * hx, 0.07 * r, 0.07 * r)
          .translate(0, 0.62 * r, 0)
          .rotateX(a)
          .translate(c[0], c[1], c[2]),
      );
    }
    const field: BufferGeometry[] = [];
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      field.push(
        box(1.2 * hx, 0.06 * r, 0.06 * r)
          .translate(0, 0.38 * r, 0)
          .rotateX(a)
          .translate(c[0], c[1], c[2]),
      );
    }
    return {
      frame: [shell(r * 0.99, 1.5 * hx, "x", c)],
      core: [annulus(0.56 * r, 0.9 * r, 1.3 * hx, "x", c)],
      stator: bars,
      "stator-insulation": [annulus(0.535 * r, 0.555 * r, 1.3 * hx, "x", c)],
      rotor: [cyl(0.46 * r, 1.4 * hx, "x", c, 28), cyl(0.12 * r, 1.95 * hx, "x", c, 16)],
      field,
      gas: [annulus(0.47 * r, 0.53 * r, 1.25 * hx, "x", c)],
    };
  },
  "grid-connection": ([hx, hy, hz]) => {
    // Inside the tank (centre -0.1 hx, -0.3 hy): three-limb core, a winding on each limb.
    const c: V = [-0.1 * hx, -0.3 * hy, 0];
    const limbs = [-0.42, 0, 0.42].map((dx) => c[0] + dx * hx);
    const core: BufferGeometry[] = limbs.map((x) =>
      box(0.12 * hx, 0.95 * hy, 0.14 * hz, x, c[1], c[2]),
    );
    core.push(
      box(1.0 * hx, 0.12 * hy, 0.14 * hz, c[0], c[1] + 0.48 * hy, c[2]),
      box(1.0 * hx, 0.12 * hy, 0.14 * hz, c[0], c[1] - 0.48 * hy, c[2]),
    );
    return {
      tank: tankWalls(1.28 * hx, 1.28 * hy, 1.18 * hz, c, 0.02 * hx),
      oil: [box(1.22 * hx, 1.15 * hy, 1.12 * hz, c[0], c[1] - 0.04 * hy, c[2])],
      core,
      winding: limbs.map((x) => annulus(0.1 * hx, 0.17 * hx, 0.7 * hy, "y", [x, c[1], c[2]])),
      paper: limbs.map((x) => annulus(0.17 * hx, 0.185 * hx, 0.72 * hy, "y", [x, c[1], c[2]])),
      bushings: [0, 1, 2].map((i) =>
        cyl(0.03 * hx, 0.32 * hy, "y", [-0.55 * hx + i * 0.45 * hx, 0.48 * hy, 0.2 * hz], 10),
      ),
    };
  },
  "vacuum-pump": ([hx, hy]) => {
    const panels: BufferGeometry[] = [];
    for (let i = 0; i < 6; i += 1)
      panels.push(
        new CylinderGeometry(0.5 * hx, 0.32 * hx, 0.05 * hy, 28, 1, true).translate(
          0,
          (-0.75 + i * 0.2) * hy,
          0,
        ),
      );
    return {
      vessel: [shell(hx * 0.84, 1.5 * hy, "y", [0, -0.2 * hy, 0])],
      shield: [shell(hx * 0.7, 1.25 * hy, "y", [0, -0.25 * hy, 0])],
      panels,
      helium: [
        cyl(0.04 * hx, 1.2 * hy, "y", [0, -0.25 * hy, 0], 10),
        ring(0.3 * hx, 0.03 * hx, "y", [0, 0.32 * hy, 0]),
      ],
      valve: [box(1.3 * hx, 0.05 * hy, 1.3 * hx, 0, 0.8 * hy, 0)],
    };
  },
  "neutral-beam": ([hx, hy, hz]) => {
    const m = Math.min(hy, hz);
    const grids: BufferGeometry[] = [];
    for (let i = 0; i < 4; i += 1)
      grids.push(cyl(0.5 * m, 0.012 * hx, "x", [(-0.54 + i * 0.03) * hx, 0.05 * hy, 0], 28));
    return {
      source: [cyl(0.55 * m, 0.3 * hx, "x", [-0.75 * hx, 0.05 * hy, 0], 28)],
      grids,
      neutraliser: [box(0.6 * hx, 0.32 * hy, 0.32 * hz, -0.15 * hx, 0.05 * hy, 0)],
      magnet: [
        box(0.25 * hx, 0.12 * hy, 0.9 * hz, 0.33 * hx, 0.42 * hy, 0),
        box(0.25 * hx, 0.12 * hy, 0.9 * hz, 0.33 * hx, -0.32 * hy, 0),
      ],
      dump: [box(0.2 * hx, 0.18 * hy, 0.5 * hz, 0.38 * hx, -0.62 * hy, 0)],
      duct: [cyl(0.2 * m, 0.6 * hx, "x", [0.72 * hx, 0.05 * hy, 0], 20)],
    };
  },
  "fuel-injector": ([hx, hy, hz]) => ({
    cabinet: [box(0.02 * hx, 1.8 * hy, 1.7 * hz, -0.94 * hx, 0, 0)],
    deuterium: [cyl(0.1 * hz, 1.2 * hy, "y", [0.45 * hx, -0.2 * hy, -0.5 * hz], 14)],
    tritium: [cyl(0.1 * hz, 1.2 * hy, "y", [0.45 * hx, -0.2 * hy, 0], 14)],
    valves: [0, 1, 2].map((i) =>
      cyl(0.05 * hz, 0.12 * hy, "y", [-0.35 * hx, 0.45 * hy, (-0.5 + i * 0.5) * hz], 12),
    ),
    controller: [box(0.3 * hx, 0.4 * hy, 0.6 * hz, -0.6 * hx, -0.4 * hy, 0)],
  }),
  breaker: ([hx, hy, hz]) => {
    const contacts: BufferGeometry[] = [];
    for (const x of [-0.5, 0, 0.5])
      for (const y of [-0.2, 0.12])
        contacts.push(cyl(0.06 * hx, 0.22 * hy, "y", [x * hx, y * hy, 0], 12));
    const chute: BufferGeometry[] = [];
    for (let i = 0; i < 7; i += 1)
      chute.push(box(1.4 * hx, 0.02 * hy, 0.6 * hz, 0, (0.35 + i * 0.06) * hy, 0));
    return {
      enclosure: tankWalls(1.96 * hx, 1.96 * hy, 1.96 * hz, [0, 0, 0], 0.02 * hx),
      contacts,
      "arc-chute": chute,
      mechanism: [
        box(0.8 * hx, 0.28 * hy, 0.6 * hz, 0, -0.65 * hy, 0),
        cyl(0.08 * hx, 0.35 * hy, "y", [0.55 * hx, -0.55 * hy, 0], 12),
      ],
    };
  },
};

/** Machine types with a bespoke internal model. */
export function hasBespokeInternals(type: string): boolean {
  return type in BUILDERS;
}

/**
 * Nested-band scales for the regions, outermost first: by volume when every region has a
 * volume fraction, otherwise equal steps (order known, proportions not).
 */
export function layerScales(internals: readonly ProductInternal[]): number[] {
  const n = internals.length;
  const known = internals.every((i) => typeof i.volumeFraction === "number");
  if (known) {
    const total = internals.reduce((s, i) => s + (i.volumeFraction ?? 0), 0) || 1;
    let cumulative = 0;
    return internals.map((i) => {
      const scale = Math.cbrt(Math.max(0.02, 1 - cumulative / total));
      cumulative += i.volumeFraction ?? 0;
      return scale;
    });
  }
  return internals.map((_, k) => 1 - (0.8 * k) / n);
}

function band(geometry: ComponentGeometry, scale: number): BufferGeometry {
  switch (geometry.kind) {
    case "box":
      return new BoxGeometry(
        geometry.sizeM.x * scale,
        geometry.sizeM.y * scale,
        geometry.sizeM.z * scale,
      );
    case "cylinder": {
      const g = new CylinderGeometry(
        geometry.radiusM * scale,
        geometry.radiusM * scale,
        geometry.heightM * (0.5 + 0.5 * scale),
        40,
      );
      if (geometry.axis === "x") g.rotateZ(Math.PI / 2);
      if (geometry.axis === "z") g.rotateX(Math.PI / 2);
      return g;
    }
    case "torus": {
      const g = new TorusGeometry(geometry.majorRadiusM, geometry.minorRadiusM * scale, 24, 96);
      if (geometry.axis === "y") g.rotateX(Math.PI / 2);
      if (geometry.axis === "x") g.rotateY(Math.PI / 2);
      return g;
    }
  }
}

/** One geometry per internal region (merged per region), or an empty map. */
export function internalModel(
  type: string,
  geometry: ComponentGeometry,
  internals: readonly ProductInternal[],
): RegionGeometry {
  const out = new Map<string, BufferGeometry>();
  const builder = BUILDERS[type];
  if (builder !== undefined) {
    const parts = builder(halfExtents(geometry));
    for (const internal of internals) {
      const list = parts[internal.id];
      if (list === undefined || list.length === 0) continue;
      const merged = merge(list);
      if (merged !== null) out.set(internal.id, merged);
    }
    for (const [id, list] of Object.entries(parts))
      if (!internals.some((i) => i.id === id)) for (const g of list) g.dispose();
    return out;
  }
  if (internals.length < 2) return out;
  const scales = layerScales(internals);
  internals.forEach((internal, k) => out.set(internal.id, band(geometry, scales[k]! * 0.995)));
  return out;
}
