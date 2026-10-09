import { useContext, useEffect, useState } from "react";
import { SHOWROOM_SCENARIOS, buildScenario } from "@forgelab/reactor-components";
import { serializeWorld } from "@forgelab/sim-core";
import { AudioEngineContext, usePresentation } from "../../presentation/context.js";
import type { DestructionEvent, FailureFamily } from "../../presentation/destruction.js";
import { useSettings } from "../../presentation/settings.js";
import { vfxDebug } from "../../presentation/vfx/runtime.js";
import { useEditor, useEditorStore } from "../store/context.js";

/**
 * Developer effects panel (`/app?debug`). Loads the showroom fault scenarios — real
 * designs the simulation runs — and shows live presentation counters. The "preview"
 * buttons play an effect recipe on the selected part WITHOUT any simulated failure: they
 * exist for tuning visuals, never change facility state, and are not in the product UI.
 */
const PREVIEW: readonly FailureFamily[] = [
  "electrical",
  "coolant",
  "cryogenic",
  "quench",
  "disruption",
  "structural",
];

const previewSeq = { next: 0 };
const nextPreviewId = () => (previewSeq.next += 1);

export function EffectsDebugPanel() {
  const store = useEditorStore();
  const audio = useContext(AudioEngineContext);
  const settings = useSettings();
  const facility = usePresentation((s) => s.facility);
  const alarm = usePresentation((s) => s.alarm);
  const destructions = usePresentation((s) => s.destructions.length);
  const selection = useEditor((v) => v.selection);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setStats(vfxDebug.runtime?.stats() ?? {});
      setLevel(audio?.level() ?? 0);
    }, 500);
    return () => clearInterval(t);
  }, [audio]);
  const preview = (family: FailureFamily) => {
    const id = selection[0];
    const runtime = vfxDebug.runtime;
    if (id === undefined || runtime === null) return;
    const c = store.getView().snapshot.components.find((x) => x.id === id);
    if (c === undefined) return;
    const p = c.state.physical.positionM;
    const event: DestructionEvent = {
      eventId: `preview::${family}::${nextPreviewId()}`,
      simulationTime: 0,
      componentId: id,
      siteComponentId: id,
      worldPosition: [p.x, p.y, p.z],
      worldDirection: [0.6, 0.6, 0.5],
      failureType: `preview-${family}`,
      family,
      severity: 0.8,
      estimatedEnergy: 1e8,
      temperature: 900,
      pressure: null,
      electricalState: "energised",
      structuralState: "fractured",
      affectedComponentIds: [],
      radiusM: 2,
      summary: `Preview: ${family}`,
      combustible: true,
    };
    runtime.execute(event);
  };
  return (
    <aside className="fx-debug" aria-label="Effects debug (developer)">
      <header>Effects debug · {settings.quality}</header>
      <dl>
        <dt>Facility</dt>
        <dd>{facility}</dd>
        <dt>Alarm</dt>
        <dd>{alarm}</dd>
        <dt>Destructions</dt>
        <dd>{destructions}</dd>
        <dt>Audio level</dt>
        <dd>{level.toFixed(3)}</dd>
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className="fx-debug__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="fx-debug__label">Load fault scenario (simulated)</p>
      <div className="fx-debug__buttons">
        {SHOWROOM_SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.fault}
            onClick={() => {
              store.loadFile(serializeWorld(buildScenario(s.id)));
              store.requestFrame(null);
            }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <p className="fx-debug__label">Preview effect on selection (not a simulated failure)</p>
      <div className="fx-debug__buttons">
        {PREVIEW.map((f) => (
          <button
            key={f}
            type="button"
            disabled={selection.length === 0}
            onClick={() => preview(f)}
          >
            {f}
          </button>
        ))}
      </div>
    </aside>
  );
}
