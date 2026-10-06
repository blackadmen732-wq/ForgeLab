import { STANDARD_GRAVITY_MPS2 } from "@forgelab/shared";
import { SIMULATION_SPEEDS } from "@forgelab/sim-core";
import type { HazardChannel } from "../state/store.js";
import { useStore, useUiState } from "../state/useStore.js";

const HAZARD_CHANNELS: readonly [HazardChannel, string][] = [
  ["off", "Normal view"],
  ["radiant", "Radiant heat"],
  ["hot-gas", "Hot gas"],
  ["fire", "Fire area"],
  ["gas-cloud", "Gas cloud"],
  ["pressure", "Pressure release"],
  ["debris", "Hot debris"],
  ["electrical", "Electrical faults"],
];
import { formatSeconds } from "./format.js";

export function Toolbar() {
  const store = useStore();
  const ui = useUiState();
  const gravityOn = ui.gravityMps2 > 0;

  return (
    <header className="toolbar">
      <div className="toolbar__group toolbar__group--brand">
        <span className="brand">ForgeLab</span>
        <span className="brand__tag">
          Milestone 0 · Simulation Foundation + cascade solver (reduced models)
        </span>
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className={ui.speed === 0 ? "button button--primary" : "button"}
          onClick={() => store.togglePlay()}
        >
          {ui.speed === 0 ? "▶ Play" : "⏸ Pause"}
        </button>
        <button type="button" className="button" onClick={() => store.reset()}>
          ⟲ Reset
        </button>

        <label className="field">
          <span className="field__label">Speed</span>
          <select
            className="select"
            value={ui.speed}
            onChange={(event) => store.setSpeed(Number(event.target.value))}
          >
            {SIMULATION_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed === 0 ? "Paused" : `${speed}×`}
              </option>
            ))}
          </select>
        </label>

        <span
          className="clock"
          title="Fixed timestep: 1/60 s. Speed changes step count, never step size."
        >
          t = {formatSeconds(ui.simulatedTimeSec)} · tick {ui.tick}
        </span>
      </div>

      <div className="toolbar__group">
        <label
          className="field"
          title="Engineering overlay of what each component is receiving. Presentation only."
        >
          <span className="field__label">Hazard view</span>
          <select
            className="select"
            value={ui.hazardView}
            disabled={ui.cascade === undefined}
            onChange={(event) => store.setHazardView(event.target.value as HazardChannel)}
          >
            {HAZARD_CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar__group">
        <label className="toggle" title="Debug switch. Sets g to 0 m/s²; nothing else changes.">
          <input
            type="checkbox"
            checked={gravityOn}
            onChange={(event) => store.setGravityEnabled(event.target.checked)}
          />
          <span>Gravity {gravityOn ? `${STANDARD_GRAVITY_MPS2} m/s²` : "off"}</span>
        </label>

        <label className="toggle" title="Grid snapping and automatic socket connection.">
          <input
            type="checkbox"
            checked={ui.snapEnabled}
            onChange={(event) => store.setSnapEnabled(event.target.checked)}
          />
          <span>Snapping</span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={ui.showCenterOfMass}
            onChange={(event) => store.setShowCenterOfMass(event.target.checked)}
          />
          <span>Centre of mass</span>
        </label>

        <label className="toggle" title="A yielded member stops holding up what rests on it.">
          <input
            type="checkbox"
            checked={ui.failurePropagation === "detach"}
            onChange={(event) =>
              store.setFailurePropagation(event.target.checked ? "detach" : "report-only")
            }
          />
          <span>Collapse on failure</span>
        </label>

        <label
          className="toggle"
          title="Optional Rapier backend: adds collision between falling parts. It never affects load, stress or failure results."
        >
          <input
            type="checkbox"
            checked={ui.dynamicsBackendId === "rapier"}
            onChange={(event) => {
              void store.setRapierEnabled(event.target.checked);
            }}
          />
          <span>Rapier collision</span>
        </label>
      </div>
    </header>
  );
}
