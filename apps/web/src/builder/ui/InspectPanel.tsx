import { currentTransform, worldAabb } from "@forgelab/sim-core";
import { ArrowLeftRight, Minus, Plus, X } from "lucide-react";
import { useMemo } from "react";
import { MAX_PEEL, PEEL_LEVELS, type SectionPlane } from "../scene/inspection.js";
import { useEditor, useEditorStore } from "../store/context.js";

const AXES = ["x", "y", "z"] as const;

/**
 * Inspection views for big machines: cut the whole plant with one plane, peel layers off
 * from the outside in, or pull the machine apart. None of it changes the design or what
 * the simulation computes.
 */
export function InspectPanel() {
  const store = useEditorStore();
  const open = useEditor((v) => v.inspectOpen);
  const section = useEditor((v) => v.section);
  const peel = useEditor((v) => v.peel);
  const explode = useEditor((v) => v.explode);
  const building = useEditor((v) => v.mode === "build");
  const components = useEditor((v) => v.snapshot.components);
  // The section slider spans the design along the chosen axis.
  const bounds = useMemo(() => {
    const out = { x: [-10, 10], y: [0, 20], z: [-10, 10] } as Record<
      "x" | "y" | "z",
      [number, number]
    >;
    if (components.length === 0) return out;
    for (const axis of AXES) out[axis] = [Infinity, -Infinity];
    for (const c of components) {
      const b = worldAabb(c.geometry, currentTransform(c));
      for (const axis of AXES) {
        out[axis][0] = Math.min(out[axis][0], b.minM[axis]);
        out[axis][1] = Math.max(out[axis][1], b.maxM[axis]);
      }
    }
    return out;
  }, [components]);

  if (!open) return null;
  const setAxis = (axis: SectionPlane["axis"] | null) => {
    if (axis === null) return store.setSection(null);
    const [lo, hi] = bounds[axis];
    store.setSection({
      axis,
      offsetM: section?.axis === axis ? section.offsetM : (lo + hi) / 2,
      flip: section?.flip ?? false,
    });
  };
  const range = section === null ? null : bounds[section.axis];

  return (
    <section className="inspect" aria-label="Inspection views">
      <header className="inspect__head">
        <strong>Inspect</strong>
        <span className="dim">views only — the design is unchanged</span>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Close inspection views"
          onClick={() => store.toggleInspect(false)}
        >
          <X />
        </button>
      </header>

      <div className="inspect__group">
        <span className="inspect__label">Section plane</span>
        <div className="seg" role="group" aria-label="Section plane axis">
          <button
            type="button"
            className={`seg__btn${section === null ? " is-active" : ""}`}
            onClick={() => setAxis(null)}
          >
            Off
          </button>
          {AXES.map((axis) => (
            <button
              key={axis}
              type="button"
              className={`seg__btn${section?.axis === axis ? " is-active" : ""}`}
              onClick={() => setAxis(axis)}
            >
              {axis.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            className={`seg__btn${section?.flip ? " is-active" : ""}`}
            disabled={section === null}
            aria-label="Keep the other side"
            data-tip="Keep the other side"
            onClick={() =>
              section !== null && store.setSection({ ...section, flip: !section.flip })
            }
          >
            <ArrowLeftRight />
          </button>
        </div>
        {section !== null && range !== null && (
          <label className="inspect__slider">
            <input
              type="range"
              min={range[0]}
              max={range[1]}
              step={0.05}
              value={section.offsetM}
              aria-label="Section plane position"
              onChange={(e) => store.setSection({ ...section, offsetM: Number(e.target.value) })}
            />
            <span className="num">
              {section.axis} = {section.offsetM.toFixed(2)} m
            </span>
          </label>
        )}
      </div>

      <div className="inspect__group">
        <span className="inspect__label">Layers</span>
        <div className="inspect__stepper">
          <button
            type="button"
            className="btn btn--sm btn--ghost btn--icon"
            aria-label="Put a layer back"
            disabled={peel === 0}
            onClick={() => store.setPeel(peel - 1)}
          >
            <Minus />
          </button>
          <span className="inspect__level">
            {PEEL_LEVELS[peel]}
            <span className="dim">
              {" "}
              {peel}/{MAX_PEEL}
            </span>
          </span>
          <button
            type="button"
            className="btn btn--sm btn--ghost btn--icon"
            aria-label="Peel off the next layer"
            disabled={peel === MAX_PEEL}
            onClick={() => store.setPeel(peel + 1)}
          >
            <Plus />
          </button>
        </div>
      </div>

      <div className="inspect__group">
        <span className="inspect__label">Exploded view</span>
        <label className="inspect__slider">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={explode}
            disabled={!building}
            aria-label="Exploded view"
            onChange={(e) => store.setExplode(Number(e.target.value))}
          />
          <span className="inspect__ends dim">
            <span>Assembled</span>
            <span>Exploded</span>
          </span>
        </label>
        {!building && <p className="dim inspect__note">Available in Build.</p>}
      </div>
    </section>
  );
}
