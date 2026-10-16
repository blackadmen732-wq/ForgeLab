import { type BufferGeometry, Matrix4, Vector3 } from "three";
import type { ComponentGeometry, ConnectionPoint } from "@forgelab/sim-core";
import type { MachineModel } from "./machines.js";
import { box, cyl, ring } from "./machineGeometry.js";
import {
  atInterface,
  boltCircle,
  flangedRing,
  hexHead,
  joinGeometry,
  roundedHousing,
} from "./industrialGeometry.js";
import {
  cylinderSkin,
  portOpenings,
  torusSample,
  torusSkin,
  type PortOpening,
} from "./vesselGeometry.js";

type Cylinder = Extract<ComponentGeometry, { kind: "cylinder" }>;
type Torus = Extract<ComponentGeometry, { kind: "torus" }>;
type Surfaces = { main: BufferGeometry[]; trim: BufferGeometry[]; accent: BufferGeometry[] };
const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;

/** Catalogue vessels use local Y. Other loaded shapes retain their existing fallback. */
export function detailedVessel(type: string, g: ComponentGeometry): boolean {
  return (
    (type === "tokamak-vessel" && g.kind === "torus" && g.axis === "y") ||
    (type === "reactor-chamber" && g.kind === "cylinder" && g.axis === "y")
  );
}

function model(s: Surfaces): MachineModel {
  return {
    main: joinGeometry(s.main),
    trim: joinGeometry(s.trim),
    accent: joinGeometry(s.accent),
    accentColor: "#617985",
    replacesEnvelope: true,
  };
}

/** Socket collars finish at the real interface, with heads visible above the flange face. */
function services(
  s: Surfaces,
  openings: readonly PortOpening[],
  points: readonly ConnectionPoint[],
): void {
  for (const { point: p, boreM: r, wallM, depthM } of openings) {
    const d = new Vector3(p.localDirection.x, p.localDirection.y, p.localDirection.z);
    const at = new Vector3(p.localPosition.x, p.localPosition.y, p.localPosition.z);
    const put = (g: BufferGeometry, depth: number) => {
      const q = at.clone().addScaledVector(d, -depth);
      return atInterface(g, q.toArray(), d.toArray());
    };
    const rim = Math.min(0.12, Math.max(0.045, r * 0.3));
    const head = Math.min(0.024, rim * 0.24);
    const height = head * 1.3;
    const flangeT = Math.min(0.065, rim * 0.6);
    s.main.push(put(flangedRing(r, r + wallM, depthM, "y", [0, 0, 0], 32), depthM / 2));
    s.main.push(put(flangedRing(r, r + rim, flangeT, "y", [0, 0, 0], 32), height + flangeT / 2));
    s.trim.push(
      put(boltCircle(r + rim * 0.64, head, height, r > 0.2 ? 12 : 8, "y", [0, 0, 0]), height / 2),
    );
    s.trim.push(put(flangedRing(r, r + wallM * 0.8, 0.006, "y", [0, 0, 0], 32), 0.003));
    // Welded root collar masks the skin tessellation at the shell penetration.
    s.trim.push(
      put(flangedRing(r + wallM * 0.7, r + rim * 0.9, 0.035, "y", [0, 0, 0], 32), depthM * 0.36),
    );
  }
  for (const p of points)
    if (p.port?.domain === "control") {
      const at = new Vector3(p.localPosition.x, p.localPosition.y, p.localPosition.z);
      const d = new Vector3(p.localDirection.x, p.localDirection.y, p.localDirection.z);
      s.accent.push(
        atInterface(
          flangedRing(0.012, 0.048, 0.055, "y", [0, 0, 0]),
          at.clone().addScaledVector(d, -0.0275).toArray(),
          d.toArray(),
        ),
      );
      s.trim.push(
        atInterface(
          boltCircle(0.075, 0.012, 0.014, 4, "y", [0, 0, 0]),
          at.clone().addScaledVector(d, -0.04).toArray(),
          d.toArray(),
        ),
      );
    }
}

/** A ring in the tube's radial/vertical plane, carried round the major circle. */
function sectorFrame(angle: number): Matrix4 {
  const radial = new Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new Vector3(-Math.sin(angle), 0, Math.cos(angle));
  return new Matrix4().makeBasis(radial, UP, tangent);
}

function sectorRing(
  R: number,
  a: number,
  depth: number,
  width: number,
  angle: number,
): BufferGeometry {
  return flangedRing(a - depth, a, width, "z", [0, 0, 0], 32)
    .applyMatrix4(sectorFrame(angle))
    .translate(R * Math.cos(angle), 0, R * Math.sin(angle));
}

function tokamak(g: Torus, points: readonly ConnectionPoint[]): MachineModel {
  const R = g.majorRadiusM,
    a = g.minorRadiusM;
  const wall = g.wallThicknessM ?? a * 0.05;
  const edge = Math.min(0.06, wall * 0.5, a * 0.025);
  const openings = portOpenings(points, a, wall);
  const s: Surfaces = { main: [], trim: [], accent: [] };
  s.main.push(torusSkin(R, a - edge, openings), torusSkin(R, a - wall, openings, true));

  // Nine representative sector joints. Their count is visual, not a confinement input.
  for (let i = 0; i < 9; i++) {
    const u = (i * TAU) / 9 + Math.PI / 36;
    const width = Math.min(0.16, a * 0.07);
    s.trim.push(sectorRing(R, a, edge * 4, width, u));
    // Heads sit on the joint's tangential flange face, clear of the casing skin.
    const tangent = new Vector3(-Math.sin(u), 0, Math.cos(u));
    for (let j = 0; j < 12; j++) {
      const v = ((j + 0.5) * TAU) / 12;
      const p = torusSample(R, a - edge * 0.9, u, v);
      const headH = Math.min(0.035, edge);
      p.position.addScaledVector(tangent, width / 2 + headH * 0.4);
      s.main.push(
        atInterface(
          hexHead(Math.min(0.026, edge * 0.85), headH),
          p.position.toArray(),
          tangent.toArray(),
        ),
      );
    }
    // Upper service panels: inset from the envelope, slightly proud of the base shell.
    const halfU = Math.min(0.13, 0.85 / R),
      halfV = 0.23;
    s.accent.push(
      torusSkin(
        R,
        a - edge * 0.28,
        [],
        false,
        [u + 0.14 - halfU, u + 0.14 + halfU],
        [Math.PI / 2 - halfV, Math.PI / 2 + halfV],
        [10, 4],
      ),
    );
  }
  for (const v of [Math.PI / 3, -Math.PI / 3, Math.PI]) {
    const r = a - edge;
    s.trim.push(ring(R + r * Math.cos(v), edge, "y", [0, r * Math.sin(v), 0]));
  }
  // Welded lifting eyes, entirely within the catalogue's overall dimensions.
  for (let i = 0; i < 4; i++) {
    const u = ((i + 0.22) * Math.PI) / 2;
    const p = torusSample(R, a - edge, u, 0.9);
    const radius = Math.min(0.13, a * 0.075);
    p.position.addScaledVector(p.normal, radius * 0.35);
    s.main.push(
      flangedRing(radius * 0.5, radius, radius * 0.4, "z", [0, 0, 0], 24)
        .applyMatrix4(sectorFrame(u))
        .translate(...p.position.toArray()),
    );
  }
  // Closed inspection cassettes are covers, not additional engineering ports.
  for (let i = 0; i < 9; i++) {
    const u = ((i + 0.5) * TAU) / 9 + Math.PI / 36;
    if (Math.abs(Math.sin(2 * u)) < 0.4) continue; // leave the cardinal service interfaces clear
    const du = Math.min(0.075, 0.6 / (R + a)),
      dv = 0.24;
    s.accent.push(torusSkin(R, a - edge * 0.2, [], false, [u - du, u + du], [-dv, dv], [8, 6]));
    for (const su of [-1, 1])
      for (const sv of [-1, 1]) {
        const p = torusSample(R, a - edge * 0.65, u + su * du * 0.83, sv * dv * 0.82);
        s.trim.push(
          atInterface(
            hexHead(Math.min(0.025, a * 0.018), edge * 1.2),
            p.position.toArray(),
            p.normal.toArray(),
          ),
        );
      }
  }
  for (const p of points.filter((p) => p.id.startsWith("foot-"))) {
    const { x, y, z } = p.localPosition,
      w = Math.min(0.8, a * 0.48),
      h = Math.min(0.09, a * 0.07);
    s.trim.push(roundedHousing([w, h, w], [x, y + h / 2, z], h * 0.12));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        s.main.push(
          hexHead(h * 0.25, h * 0.35).translate(x + sx * w * 0.34, y + h * 1.1, z + sz * w * 0.34),
        );
    s.main.push(box(w * 0.14, h * 2.8, w * 0.7, x, y + h * 2.2, z));
  }
  services(s, openings, points);
  return model(s);
}

function chamber(g: Cylinder, points: readonly ConnectionPoint[]): MachineModel {
  const r = g.radiusM,
    h = g.heightM,
    hy = h / 2,
    wall = g.wallThicknessM ?? r * 0.04;
  const edge = Math.min(0.025, wall * 0.25, r * 0.02),
    end = Math.min(0.12, h * 0.07);
  const openings = portOpenings(points, Math.min(r, hy), wall);
  const s: Surfaces = { main: [], trim: [], accent: [] };
  s.main.push(
    cylinderSkin(r - edge, h - end * 1.4, openings),
    cylinderSkin(r - wall, h - end * 1.4, openings, true),
  );
  for (const side of [-1, 1]) {
    // Removable end cover, gasket, bolted rim. All hardware stays below the real end face.
    const y = side * (hy - end * 0.55),
      t = end * 0.5;
    s.main.push(
      flangedRing(r * 0.72, r, t, "y", [0, y, 0]),
      cyl(r * 0.735, t * 0.6, "y", [0, y, 0], 64),
    );
    s.trim.push(
      boltCircle(r * 0.88, Math.min(0.028, r * 0.025), end * 0.22, 24, "y", [
        0,
        side * (hy - end * 0.19),
        0,
      ]),
    );
    s.trim.push(ring(r * 0.76, edge * 0.6, "y", [0, side * (hy - end * 0.29), 0]));
  }
  const covers: PortOpening[] = points
    .filter((p) => p.connectionType === "mount")
    .map((point) => ({
      point,
      boreM: Math.min(r * 0.22, hy * 0.22) * 1.12,
      wallM: 0,
      depthM: Math.max(0.18, r * 0.15),
    }));
  for (const y of [-0.55, 0, 0.55]) {
    const bandHoles = [...openings, ...covers].map((o) => ({
      ...o,
      point: {
        ...o.point,
        localPosition: { ...o.point.localPosition, y: o.point.localPosition.y - y * hy },
      },
    }));
    s.trim.push(
      torusSkin(r - edge, edge, bandHoles, false, undefined, undefined, [64, 6]).translate(
        0,
        y * hy,
        0,
      ),
    );
  }
  for (let i = 0; i < 12; i++) {
    const u = ((i + 0.5) * TAU) / 12;
    s.accent.push(
      box(edge * 1.5, h * 0.76, Math.min(0.065, r * 0.06))
        .rotateY(-u)
        .translate((r - edge) * Math.cos(u), 0, (r - edge) * Math.sin(u)),
    );
  }
  for (const p of points.filter((p) => p.connectionType === "mount")) {
    const at = p.localPosition,
      d = p.localDirection;
    const radius = Math.min(r * 0.22, hy * 0.22),
      t = Math.min(0.045, r * 0.05);
    const place = (g: BufferGeometry, offset: number) =>
      atInterface(
        g,
        [at.x - d.x * offset, at.y - d.y * offset, at.z - d.z * offset],
        [d.x, d.y, d.z],
      );
    s.accent.push(place(cyl(radius, t, "y", [0, 0, 0], 40), t * 0.8));
    s.trim.push(
      place(boltCircle(radius * 0.78, radius * 0.065, t * 0.4, 8, "y", [0, 0, 0]), t * 0.3),
    );
    s.main.push(place(flangedRing(radius * 0.96, radius * 1.1, t, "y", [0, 0, 0]), t));
  }
  // Reinforced base skirt with four gussets; this is part of the machine, not a new support component.
  s.trim.push(flangedRing(r * 0.78, r * 0.92, end * 0.55, "y", [0, -hy + end * 0.35, 0]));
  for (let i = 0; i < 4; i++)
    s.trim.push(
      box(r * 0.2, end * 1.2, r * 0.06)
        .translate(r * 0.8, -hy + end * 0.6, 0)
        .rotateY((i * Math.PI) / 2),
    );
  services(s, openings, points);
  return model(s);
}

export function vesselModel(
  type: string,
  geometry: ComponentGeometry,
  points: readonly ConnectionPoint[],
): MachineModel | null {
  if (type === "tokamak-vessel" && geometry.kind === "torus" && geometry.axis === "y")
    return tokamak(geometry, points);
  if (type === "reactor-chamber" && geometry.kind === "cylinder" && geometry.axis === "y")
    return chamber(geometry, points);
  return null;
}

/** Existing product regions, now modelled as shells/tiles. Thickness allocation is SCHEMATIC. */
export function vesselInternals(
  type: string,
  g: ComponentGeometry,
  points: readonly ConnectionPoint[],
): Map<string, BufferGeometry> | null {
  if (!detailedVessel(type, g)) return null;
  const out = new Map<string, BufferGeometry>();
  if (g.kind === "torus") {
    const R = g.majorRadiusM,
      a = g.minorRadiusM,
      t = g.wallThicknessM ?? a * 0.05;
    const holes = portOpenings(points, a, t);
    out.set("outer-shell", torusSkin(R, a - t * 0.6, holes));
    out.set("shield-water", torusSkin(R, a - t * 0.72, holes));
    out.set("inner-shell", torusSkin(R, a - t * 0.9, holes, true));
    const tiles: BufferGeometry[] = [];
    const rows = 12,
      sectors = 48,
      gap = 0.035;
    for (let i = 0; i < sectors; i++)
      for (let j = 0; j < rows; j++)
        tiles.push(
          torusSkin(
            R,
            a - t * 1.16,
            holes,
            true,
            [((i + gap) * TAU) / sectors, ((i + 1 - gap) * TAU) / sectors],
            [((j + gap) * TAU) / rows, ((j + 1 - gap) * TAU) / rows],
            [3, 2],
          ),
        );
    out.set("first-wall", joinGeometry(tiles));
    out.set("plasma", torusSkin(R, (a - t) * 0.92));
  } else if (g.kind === "cylinder") {
    const r = g.radiusM,
      h = g.heightM,
      t = g.wallThicknessM ?? r * 0.04;
    const holes = portOpenings(points, Math.min(r, h / 2), t);
    out.set(
      "wall",
      joinGeometry([
        cylinderSkin(r - t * 0.35, h * 0.96, holes),
        cylinderSkin(r - t * 1.06, h * 0.96, holes, true),
      ]),
    );
    out.set(
      "limiter",
      joinGeometry(
        [-0.3, 0, 0.3].map((y) =>
          flangedRing((r - t) * 0.94, r - t, Math.min(0.045, h * 0.025), "y", [0, y * h, 0]),
        ),
      ),
    );
    out.set("plasma", cyl((r - t) * 0.9, h * 0.86, "y", [0, 0, 0], 64));
  }
  return out;
}
