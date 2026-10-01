import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial, type Group } from "three";
import { frameScalar } from "@forgelab/sim-runner";
import type { SimulationComponent } from "@forgelab/sim-core";
import { useEditor, useEditorStore } from "../store/context.js";
import { PALETTE } from "./appearance.js";
import { fieldCoils, seedPoints, traceLine, type FieldLine } from "./fieldLines.js";

/**
 * The Magnetic view's field lines: streamlines of the field sim-core computes from the
 * coils' geometry. With coils selected, only their field is drawn (isolate a coil's
 * contribution); otherwise the resultant field of every coil. Currents are the ones sim-core
 * publishes — in Build its start-of-run solve (an unpowered coil makes no field), while
 * simulating the run's live current, so the lines fade as a coil dumps. Lines are traced one per idle tick so the view
 * never stalls; colour runs from dim to bright with field strength (log scale, 0.1–10 T).
 */
const DIM = PALETTE.dim;
const BRIGHT = new Color("#ede9fe");

function colourFor(fieldT: number, out: Color): Color {
  const t = Math.min(1, Math.max(0, (Math.log10(Math.max(fieldT, 1e-3)) + 1) / 2));
  return t < 0.5
    ? out.copy(DIM).lerp(PALETTE.field, t * 2)
    : out.copy(PALETTE.field).lerp(BRIGHT, (t - 0.5) * 2);
}

function lineObject(line: FieldLine, material: LineBasicMaterial): Line {
  const positions = new Float32Array(line.points.length * 3);
  const colours = new Float32Array(line.points.length * 3);
  const c = new Color();
  line.points.forEach((p, i) => {
    positions.set([p.x, p.y, p.z], i * 3);
    colourFor(line.fieldT[i]!, c);
    colours.set([c.r, c.g, c.b], i * 3);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("color", new BufferAttribute(colours, 3));
  const object = new Line(g, material);
  object.frustumCulled = false;
  object.renderOrder = 4;
  return object;
}

export function FieldLines() {
  const store = useEditorStore();
  const overlay = useEditor((v) => v.overlay);
  const mode = useEditor((v) => v.mode);
  const components = useEditor((v) => v.snapshot.components);
  const selection = useEditor((v) => v.selection);
  const invalidate = useThree((s) => s.invalidate);
  const [group, setGroup] = useState<Group | null>(null);
  const material = useMemo(
    () =>
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        // The field runs inside vessels and casings: an engineering view draws it over them.
        depthTest: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const [currents, setCurrents] = useState<string>("");

  // Live currents while simulating: sampled each frame, applied when they move 2 %.
  useFrame(() => {
    if (overlay !== "magnetic" || mode !== "simulate") return;
    const frame = store.frame;
    if (frame === null) return;
    const key = components
      .filter((c) => c.role === "magnet-coil")
      .map((c) => {
        const i = store.frameIndexOf(c.id);
        const a = i === undefined ? 0 : frameScalar(frame, i, "coilCurrentA");
        return `${c.id}:${Math.round(a * 50) / 50}`;
      })
      .join("|");
    if (key !== currents) setCurrents(key);
  });

  const coils = useMemo(() => {
    if (overlay !== "magnetic") return [];
    const live = new Map(
      currents
        .split("|")
        .filter((s) => s !== "")
        .map((s) => {
          const [id, a] = s.split(":");
          return [id!, Number(a)] as const;
        }),
    );
    const selected = new Set(selection);
    const picked = components.filter((c) => c.role === "magnet-coil" && selected.has(c.id));
    const source: readonly SimulationComponent[] =
      picked.length > 0 ? picked : components.filter((c) => c.role === "magnet-coil");
    // The current sim-core publishes: in Build, its start-of-run solve (an unpowered coil
    // carries none); while simulating, the run's live current.
    return fieldCoils(source, (c) =>
      mode === "simulate" ? (live.get(c.id) ?? 0) : (c.state.plant.magnet?.currentA ?? 0),
    );
  }, [overlay, components, selection, mode, currents]);

  useEffect(() => {
    if (group === null) return;
    const clear = () => {
      for (const child of [...group.children]) {
        group.remove(child);
        (child as Line).geometry.dispose();
      }
    };
    clear();
    if (coils.length === 0) {
      invalidate();
      return;
    }
    // Trace one line per tick so a large design never freezes the view.
    const points = coils.flatMap((c) => c.segments.map((s) => s.a));
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    const centre = { x: cx / points.length, y: cy / points.length, z: cz / points.length };
    const extent = Math.max(
      1,
      ...points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z)),
    );
    const options = { stepM: extent / 50, maxSteps: 400, centre, radiusM: extent * 2.5 };
    const seeds = seedPoints(components, coils).slice(0, 20);
    let k = 0;
    let timer = 0;
    const next = () => {
      const seed = seeds[k];
      if (seed === undefined) return;
      k += 1;
      const line = traceLine(coils, seed, options);
      if (line.points.length > 3) {
        group.add(lineObject(line, material));
        invalidate();
      }
      timer = window.setTimeout(next, 0);
    };
    timer = window.setTimeout(next, 0);
    return () => {
      window.clearTimeout(timer);
      clear();
    };
  }, [group, coils, components, material, invalidate]);

  if (overlay !== "magnetic") return null;
  return <group ref={setGroup} name="field-lines" />;
}
