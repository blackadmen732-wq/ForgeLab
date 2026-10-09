import { FlaskConical } from "lucide-react";
import { useMemo } from "react";
import {
  FAMILY_LOOK,
  MATERIAL_FAMILIES,
  materialName,
  materialUsage,
} from "../scene/materialView.js";
import { useEditor, useEditorStore } from "../store/context.js";
import { materialLab } from "./materialLab.js";

/**
 * The Materials view's legend: every material in the design, by family, with how many parts
 * contain it. Pick one to light up those parts (casings or inside); open it in the Material
 * Lab for its sourced properties.
 */
export function MaterialLegend() {
  const store = useEditorStore();
  const overlay = useEditor((v) => v.overlay);
  const components = useEditor((v) => v.snapshot.components);
  const focus = useEditor((v) => v.materialFocus);
  const usage = useMemo(() => materialUsage(components), [components]);
  if (overlay !== "materials") return null;
  return (
    <section className="legend" aria-label="Materials legend">
      <header className="legend__head">
        <strong>Materials</strong>
        <span className="dim">pick one to find it</span>
      </header>
      <div className="legend__body">
        {MATERIAL_FAMILIES.filter((f) => usage.has(f)).map((family) => (
          <div key={family} className="legend__family">
            <div className="legend__family-name">
              <span
                className="legend__swatch"
                style={{ background: FAMILY_LOOK[family].color }}
                aria-hidden="true"
              />
              {FAMILY_LOOK[family].label}
            </div>
            {[...usage.get(family)!].map(([id, parts]) => (
              <div key={id} className={`legend__item${focus === id ? " is-active" : ""}`}>
                <button
                  type="button"
                  className="legend__pick"
                  aria-pressed={focus === id}
                  onClick={() => store.setMaterialFocus(id)}
                >
                  {materialName(id)}
                  <span className="dim">
                    {parts.length} part{parts.length === 1 ? "" : "s"}
                  </span>
                </button>
                {focus === id && family !== "fluid" && family !== "other" && (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => materialLab.open(id)}
                  >
                    <FlaskConical /> Material Lab
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
