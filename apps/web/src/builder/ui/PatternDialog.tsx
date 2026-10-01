import { FlipHorizontal2, Rows3, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import { vec3, type Vec3 } from "@forgelab/shared";
import { worldAabb } from "@forgelab/sim-core";
import { Dialog } from "../../components/Dialog.js";
import { useEditor, useEditorStore } from "../store/context.js";
import type { SelectionPattern } from "../store/editor.js";

/**
 * Pattern tools: copy the selection into a ring (radial array), a row (linear array) or
 * its mirror image. Building a fusion machine means placing many identical coils, ports
 * and supports; nobody should place 18 TF coils by hand. Links between the selected parts
 * are copied into every instance.
 */
type Kind = SelectionPattern["kind"];
type Axis = "x" | "y" | "z";
type Centre = "selection" | "origin" | "custom";

const AXES: Record<Axis, Vec3> = { x: vec3(1, 0, 0), y: vec3(0, 1, 0), z: vec3(0, 0, 1) };
const PLANE_NAMES: Record<Axis, string> = {
  x: "YZ plane (flip X)",
  y: "XZ plane (flip Y)",
  z: "XY plane (flip Z)",
};

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <label className="pattern__field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {unit !== undefined && <span className="dim">{unit}</span>}
    </label>
  );
}

export function PatternDialog() {
  const store = useEditorStore();
  const selection = useEditor((v) => v.selection);
  const components = useEditor((v) => v.snapshot.components);
  const close = () => store.openDialog(null);

  const box = useMemo(() => {
    const parts = components.filter((c) => selection.includes(c.id));
    if (parts.length === 0) return null;
    const boxes = parts.map((c) => worldAabb(c.geometry, c.transform));
    const min = vec3(
      Math.min(...boxes.map((b) => b.minM.x)),
      Math.min(...boxes.map((b) => b.minM.y)),
      Math.min(...boxes.map((b) => b.minM.z)),
    );
    const max = vec3(
      Math.max(...boxes.map((b) => b.maxM.x)),
      Math.max(...boxes.map((b) => b.maxM.y)),
      Math.max(...boxes.map((b) => b.maxM.z)),
    );
    return {
      min,
      max,
      centre: vec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2),
    };
  }, [components, selection]);

  const [kind, setKind] = useState<Kind>("radial");
  const [count, setCount] = useState(6);
  const [axis, setAxis] = useState<Axis>("y");
  const [centre, setCentre] = useState<Centre>("origin");
  const [custom, setCustom] = useState<Vec3>(vec3(0, 0, 0));
  const [spanDeg, setSpanDeg] = useState(360);
  const width = box === null ? 1 : Math.max(0.5, box.max.x - box.min.x);
  const [step, setStep] = useState<Vec3>(vec3(Math.round((width + 1) * 10) / 10, 0, 0));
  const [replace, setReplace] = useState(false);

  if (box === null)
    return (
      <Dialog title="Pattern" onClose={close}>
        <p>Select the parts to copy first.</p>
      </Dialog>
    );

  const point = centre === "selection" ? box.centre : centre === "origin" ? vec3(0, 0, 0) : custom;
  const n = Math.max(2, Math.min(kind === "radial" ? 72 : 100, Math.round(count)));
  const full = Math.abs(spanDeg - 360) < 1e-9;
  const apart = full ? spanDeg / n : spanDeg / (n - 1);
  const apply = () => {
    if (kind === "radial")
      store.patternSelected({
        kind,
        origin: point,
        axis: AXES[axis],
        count: n,
        spanRad: (spanDeg * Math.PI) / 180,
      });
    else if (kind === "linear") store.patternSelected({ kind, step, count: n });
    else store.patternSelected({ kind, point, normal: AXES[axis], replace });
    close();
  };
  const vecFields = (v: Vec3, set: (v: Vec3) => void, unit: string) => (
    <div className="pattern__vec">
      {(["x", "y", "z"] as const).map((k) => (
        <NumberField
          key={k}
          label={k.toUpperCase()}
          value={v[k]}
          step={0.1}
          unit={unit}
          onChange={(value) => set({ ...v, [k]: value })}
        />
      ))}
    </div>
  );

  return (
    <Dialog
      title="Pattern"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={apply}>
            {kind === "mirror" ? "Mirror" : `Make ${n} instances`}
          </button>
        </>
      }
    >
      <div className="segmented pattern__kinds" role="tablist" aria-label="Pattern kind">
        {(
          [
            ["radial", "Radial array", <RotateCw key="r" />],
            ["linear", "Linear array", <Rows3 key="l" />],
            ["mirror", "Mirror", <FlipHorizontal2 key="m" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            className={kind === id ? "is-active" : ""}
            onClick={() => setKind(id)}
          >
            {icon} {label}
          </button>
        ))}
      </div>
      <div className="pattern">
        {kind !== "linear" && (
          <label className="pattern__field">
            <span>{kind === "radial" ? "Axis" : "Mirror across"}</span>
            <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)}>
              {(["x", "y", "z"] as const).map((a) => (
                <option key={a} value={a}>
                  {kind === "radial" ? `${a.toUpperCase()} axis` : PLANE_NAMES[a]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "linear" && (
          <label className="pattern__field">
            <span>{kind === "radial" ? "Axis through" : "Plane through"}</span>
            <select value={centre} onChange={(e) => setCentre(e.target.value as Centre)}>
              <option value="origin">World origin</option>
              <option value="selection">Selection centre</option>
              <option value="custom">A point…</option>
            </select>
          </label>
        )}
        {kind !== "linear" && centre === "custom" && vecFields(custom, setCustom, "m")}
        {kind !== "mirror" && (
          <NumberField
            label="Instances"
            value={count}
            min={2}
            max={kind === "radial" ? 72 : 100}
            onChange={setCount}
          />
        )}
        {kind === "radial" && (
          <NumberField
            label="Span"
            value={spanDeg}
            min={1}
            max={360}
            unit="°"
            onChange={setSpanDeg}
          />
        )}
        {kind === "linear" && (
          <>
            <span className="pattern__label">Step between instances</span>
            {vecFields(step, setStep, "m")}
          </>
        )}
        {kind === "mirror" && (
          <label className="pattern__check">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            Replace the originals (otherwise keep both sides)
          </label>
        )}
        <p className="dim pattern__summary">
          {kind === "radial"
            ? `${n} instances, ${apart.toFixed(1)}° apart about the ${axis.toUpperCase()} axis through (${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)}) m.`
            : kind === "linear"
              ? `${n} instances in a row.`
              : "Mirrored placements. Parts are not turned into left-handed twins: each copy takes the orientation of its mirror image about its own symmetry plane."}{" "}
          Links between the selected parts are copied into every instance.
        </p>
      </div>
    </Dialog>
  );
}
