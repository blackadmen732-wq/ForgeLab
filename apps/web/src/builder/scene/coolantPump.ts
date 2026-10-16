import { type BufferGeometry, ExtrudeGeometry, Shape } from "three";
import { type ComponentGeometry, type ConnectionPoint } from "@forgelab/sim-core";
import type { MachineModel } from "./machines.js";
import { box, cyl, halfExtents, ring, type V } from "./machineGeometry.js";
import {
  atInterface,
  boltCircle,
  curvedConduit,
  flangedRing,
  joinGeometry,
  roundedHousing,
} from "./industrialGeometry.js";

/**
 * Vertical in-line centrifugal pump: schematic manufactured construction in metres.
 * Keeps the existing 2 m envelope, port definitions and internal-region layout. These
 * casing details are presentation, not a pressure-vessel or manufacturing calculation.
 */
export function buildCoolantPump(
  geometry: ComponentGeometry,
  points: readonly ConnectionPoint[],
  part?: "base" | "casing" | "motor" | "drive",
): MachineModel {
  const [hx, hy, hz] = halfExtents(geometry);
  const m = Math.min(hx, hz);
  const main: BufferGeometry[] = [];
  const trim: BufferGeometry[] = [];
  const accent: BufferGeometry[] = [];

  if (part === undefined || part === "base") {
    // Open channel skid, four separately bolted pads and cast casing feet.
    for (const z of [-0.68, 0.68]) {
      trim.push(box(1.82 * hx, 0.12 * hy, 0.045 * hz, 0, -0.92 * hy, z * hz));
      for (const y of [-0.985, -0.85])
        trim.push(box(1.82 * hx, 0.025 * hy, 0.18 * hz, 0, y * hy, z * hz));
      for (const x of [-0.72, 0.72]) {
        trim.push(
          roundedHousing(
            [0.32 * hx, 0.075 * hy, 0.38 * hz],
            [x * hx, -0.95 * hy, z * hz],
            0.012 * m,
          ),
        );
        main.push(cyl(0.042 * m, 0.035 * hy, "y", [x * hx, -0.82 * hy, z * hz], 6));
      }
    }
    for (const x of [-0.34, 0.34])
      for (const z of [-0.32, 0.32]) {
        main.push(
          roundedHousing(
            [0.14 * hx, 0.22 * hy, 0.15 * hz],
            [x * hx, -0.75 * hy, z * hz],
            0.018 * m,
          ),
        );
      }
  }
  if (part === undefined || part === "casing") {
    // A scroll-shaped volute, not a generic drum. The original impeller remains at y=-0.55.
    const scroll = new Shape();
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      const r = (0.49 + (0.07 * i) / 64) * m;
      if (i === 0) scroll.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else scroll.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    scroll.closePath();
    main.push(
      new ExtrudeGeometry(scroll, {
        depth: 0.44 * hy,
        bevelEnabled: true,
        bevelSize: 0.025 * m,
        bevelThickness: 0.025 * hy,
        bevelSegments: 2,
        steps: 1,
      })
        .rotateX(-Math.PI / 2)
        .translate(0, -0.77 * hy, 0),
    );
    main.push(flangedRing(0.12 * m, 0.61 * m, 0.06 * hy, "y", [0, -0.3 * hy, 0]));
    trim.push(boltCircle(0.55 * m, 0.024 * m, 0.035 * hy, 12, "y", [0, -0.25 * hy, 0]));
    trim.push(ring(0.57 * m, 0.008 * m, "y", [0, -0.34 * hy, 0]));
    // Drain plug and a bolted inspection boss on the front of the casing.
    main.push(cyl(0.14 * m, 0.05 * hz, "z", [0, -0.55 * hy, 0.54 * hz], 32));
    trim.push(boltCircle(0.105 * m, 0.015 * m, 0.03 * hz, 6, "z", [0, -0.55 * hy, 0.58 * hz]));
    trim.push(cyl(0.035 * m, 0.09 * hz, "z", [0, -0.72 * hy, 0.55 * hz], 6));
  }
  if (part === undefined || part === "motor") {
    // Motor barrel, radial cooling fins, end shields and fan-cowl ventilation.
    accent.push(cyl(0.36 * m, 0.78 * hy, "y", [0, 0.45 * hy, 0], 48));
    for (let i = 0; i < 28; i += 1) {
      const a = (i * Math.PI * 2) / 28;
      accent.push(
        box(0.105 * m, 0.64 * hy, 0.016 * m)
          .rotateY(-a)
          .translate(Math.cos(a) * 0.385 * m, 0.45 * hy, Math.sin(a) * 0.385 * m),
      );
    }
    for (const y of [0.08, 0.82])
      main.push(flangedRing(0.08 * m, 0.405 * m, 0.055 * hy, "y", [0, y * hy, 0]));
    accent.push(cyl(0.42 * m, 0.09 * hy, "y", [0, 0.895 * hy, 0], 48));
    trim.push(boltCircle(0.345 * m, 0.018 * m, 0.02 * hy, 8, "y", [0, 0.948 * hy, 0]));
    for (let i = 0; i < 20; i += 1) {
      const a = (i * Math.PI * 2) / 20;
      trim.push(
        box(0.1 * m, 0.006 * hy, 0.025 * m)
          .rotateY(-a)
          .translate(Math.cos(a) * 0.27 * m, 0.944 * hy, Math.sin(a) * 0.27 * m),
      );
    }
  }
  if (part === undefined || part === "drive") {
    // A windowed coupling guard; the live shaft is inside it, not floating above the motor.
    for (const y of [-0.235, 0.035])
      accent.push(flangedRing(0.16 * m, 0.24 * m, 0.035 * hy, "y", [0, y * hy, 0]));
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI * 2) / 8;
      accent.push(
        box(
          0.035 * m,
          0.24 * hy,
          0.035 * m,
          Math.cos(a) * 0.21 * m,
          -0.1 * hy,
          Math.sin(a) * 0.21 * m,
        ),
      );
    }
  }
  if (part === undefined || part === "motor") {
    // Small nameplate and fixings; no invented ratings or manufacturer branding.
    trim.push(
      roundedHousing([0.24 * hx, 0.12 * hy, 0.025 * hz], [0, 0.52 * hy, 0.435 * m], 0.008 * m),
    );
    for (const x of [-0.09, 0.09])
      main.push(cyl(0.009 * m, 0.01 * hz, "z", [x * hx, 0.52 * hy, 0.452 * m], 6));
  }
  for (const p of points) {
    const at: V = [p.localPosition.x, p.localPosition.y, p.localPosition.z];
    const dir: V = [p.localDirection.x, p.localDirection.y, p.localDirection.z];
    if (p.port?.domain === "fluid" && (part === undefined || part === "casing")) {
      const bore = p.port.innerDiameterM / 2;
      const side = Math.sign(at[0]) || 1;
      // Both end tangents meet the existing ±X fluid sockets; no decorative dead ports.
      main.push(
        curvedConduit(
          [
            at,
            [at[0] - side * 0.25 * hx, at[1], at[2]],
            [side * 0.55 * hx, -0.12 * hy, 0],
            [side * 0.45 * hx, -0.36 * hy, 0],
            [side * 0.4 * hx, -0.55 * hy, 0],
          ],
          bore,
          0.025 * m,
        ),
      );
      const flangeR = bore + 0.15 * m;
      const face: V = [at[0] - side * 0.055 * hx, at[1], at[2]];
      main.push(atInterface(flangedRing(bore, flangeR, 0.09 * hx, "y", [0, 0, 0]), face, dir));
      trim.push(
        atInterface(
          boltCircle(bore + 0.1 * m, 0.024 * m, 0.025 * hx, 8, "y", [0, 0, 0]),
          [at[0] - side * 0.005 * hx, at[1], at[2]],
          dir,
        ),
      );
      trim.push(
        atInterface(flangedRing(bore, bore + 0.035 * m, 0.008 * hx, "y", [0, 0, 0]), at, dir),
      );
    } else if (p.port?.domain === "electrical" && (part === undefined || part === "motor")) {
      accent.push(
        roundedHousing(
          [0.44 * hx, 0.32 * hy, 0.28 * hz],
          [at[0], at[1], at[2] + 0.17 * hz],
          0.025 * m,
        ),
      );
      trim.push(
        roundedHousing(
          [0.4 * hx, 0.28 * hy, 0.025 * hz],
          [at[0], at[1], at[2] + 0.015 * hz],
          0.012 * m,
        ),
      );
      main.push(cyl(0.07 * m, 0.025 * hz, "z", [at[0], at[1], at[2] + 0.0125 * hz], 12));
      main.push(
        curvedConduit(
          [
            [0, 0.13 * hy, -0.72 * hz],
            [0, 0.28 * hy, -0.64 * hz],
            [0, 0.42 * hy, -0.38 * m],
          ],
          0.025 * m,
          0.008 * m,
        ),
      );
    } else if (p.port?.domain === "control" && (part === undefined || part === "motor")) {
      trim.push(
        atInterface(
          flangedRing(0.018 * m, 0.04 * m, 0.065 * hy, "y", [0, 0, 0]),
          [at[0], at[1] - 0.0325 * hy, at[2]],
          dir,
        ),
      );
    }
  }
  return {
    main: main.length ? joinGeometry(main) : null,
    trim: trim.length ? joinGeometry(trim) : null,
    accent: accent.length ? joinGeometry(accent) : null,
    accentColor: "#306c83",
    replacesEnvelope: true,
  };
}

/** Visible coupling, driven by the existing presentation animator's activity value. */
export function coolantPumpCoupling(geometry: ComponentGeometry): {
  geometry: BufferGeometry;
  axis: "y";
  offset: [number, number, number];
} {
  const [hx, hy, hz] = halfExtents(geometry);
  const m = Math.min(hx, hz);
  return {
    geometry: joinGeometry([
      cyl(0.055 * m, 0.27 * hy, "y"),
      cyl(0.125 * m, 0.065 * hy, "y", [0, 0.06 * hy, 0], 24),
      cyl(0.125 * m, 0.065 * hy, "y", [0, -0.06 * hy, 0], 24),
      boltCircle(0.09 * m, 0.014 * m, 0.025 * hy, 6, "y", [0, 0.105 * hy, 0]),
    ]),
    axis: "y",
    offset: [0, -0.1 * hy, 0],
  };
}
