import { CircleCheck, TriangleAlert, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { preflight, type PreflightSystem } from "@forgelab/sim-core";
import { Dialog } from "../../components/Dialog.js";
import { useEditor, useEditorStore } from "../store/context.js";

/**
 * Preflight before ACTIVATE. sim-core's checks explain what the run is likely to run into
 * — an open coolant loop, a vessel with no vacuum pump, a pipe wall too thin for its loop
 * pressure — and point at the parts involved. It never blocks a well-formed design and
 * never says which part to use instead: Activate anyway is always there, because watching
 * a bad idea fail is part of the game.
 */
const SYSTEMS: readonly { id: PreflightSystem; label: string; roles: readonly string[] }[] = [
  {
    id: "electrical",
    label: "Electrical",
    roles: ["power-supply", "generator", "conductor", "switch"],
  },
  {
    id: "cooling",
    label: "Cooling",
    roles: ["coolant-pump", "coolant-pipe", "heat-exchanger"],
  },
  { id: "cryogenics", label: "Cryogenics", roles: ["magnet-coil"] },
  { id: "vacuum", label: "Vacuum", roles: ["vacuum-pump"] },
  { id: "fuel", label: "Fuel", roles: ["fuel-injector"] },
  { id: "heating", label: "Plasma heating", roles: ["plasma-heater"] },
  { id: "magnets", label: "Magnets", roles: ["magnet-coil"] },
  { id: "design", label: "Connections", roles: [] },
];

export function PreflightDialog() {
  const store = useEditorStore();
  const snapshot = useEditor((v) => v.snapshot);
  const [skip, setSkip] = useState(store.skipPreflight);
  const report = useMemo(() => preflight(snapshot.components, snapshot.connections), [snapshot]);
  const roles = useMemo(() => new Set(snapshot.components.map((c) => c.role)), [snapshot]);
  const close = () => store.openDialog(null);
  const activate = () => {
    store.setSkipPreflight(skip);
    close();
    store.startSimulation();
  };
  const show = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    store.select(ids);
    store.requestFrame(ids);
  };

  return (
    <Dialog
      title="Preflight"
      onClose={close}
      footer={
        <>
          <label className="preflight__skip">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Don&apos;t check again this session
          </label>
          <button type="button" className="btn" onClick={close}>
            Back to Build
          </button>
          <button
            type="button"
            className="btn btn--primary"
            autoFocus
            disabled={!report.canActivate}
            onClick={activate}
          >
            <Zap /> Activate anyway
          </button>
        </>
      }
    >
      <p className="dim preflight__note">
        Likely problems, from the same models the run uses. Nothing here stops you: the simulation
        decides what happens.
      </p>
      <ul className="preflight">
        {SYSTEMS.map((system) => {
          const items = report.items.filter((i) => i.system === system.id);
          if (items.length === 0) {
            if (!system.roles.some((r) => roles.has(r as never))) return null;
            return (
              <li key={system.id} className="preflight__row is-ok">
                <CircleCheck aria-hidden="true" />
                <span>
                  <strong>{system.label}</strong> <span className="dim">nothing to report</span>
                </span>
              </li>
            );
          }
          return items.map((item, k) => (
            <li key={`${system.id}-${k}`} className="preflight__row is-warn">
              <TriangleAlert aria-hidden="true" />
              <span>
                <strong>{system.label}</strong> {item.message}
                {item.componentIds.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost preflight__show"
                    onClick={() => show(item.componentIds)}
                  >
                    Show
                  </button>
                )}
              </span>
            </li>
          ));
        })}
      </ul>
    </Dialog>
  );
}
