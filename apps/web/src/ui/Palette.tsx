import { useRef } from "react";
import { COMPONENT_PALETTE } from "../state/store.js";
import { useStore, useUiState } from "../state/useStore.js";

export function Palette() {
  const store = useStore();
  const ui = useUiState();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="panel panel--left">
      <h2 className="panel__title">Components</h2>
      <p className="panel__hint">
        Place a part, then drag the gizmo to move it. Sockets within 0.35 m of a compatible socket
        connect automatically while snapping is on.
      </p>

      <div className="palette">
        {COMPONENT_PALETTE.map((definition) => (
          <button
            key={definition.type}
            type="button"
            className="palette__item"
            title={definition.description}
            onClick={() => store.addComponent(definition.type)}
          >
            <span className="palette__name">{definition.name}</span>
            <span className="palette__meta">
              {definition.nominalSizeM.x.toFixed(2)} × {definition.nominalSizeM.y.toFixed(2)} ×{" "}
              {definition.nominalSizeM.z.toFixed(2)} m
            </span>
          </button>
        ))}
      </div>

      <h2 className="panel__title">Edit</h2>
      <div className="button-row">
        <button
          type="button"
          className="button"
          disabled={ui.selectedId === null}
          onClick={() => store.duplicateSelected()}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={ui.selectedId === null}
          onClick={() => store.deleteSelected()}
        >
          Delete
        </button>
      </div>
      <div className="button-row">
        <button
          type="button"
          className={ui.gizmoMode === "translate" ? "button button--primary" : "button"}
          onClick={() => store.setGizmoMode("translate")}
        >
          Move
        </button>
        <button
          type="button"
          className={ui.gizmoMode === "rotate" ? "button button--primary" : "button"}
          onClick={() => store.setGizmoMode("rotate")}
        >
          Rotate
        </button>
      </div>
      <label className="field">
        <span className="field__label">Grid</span>
        <select
          className="select"
          value={ui.snapSizeM}
          disabled={!ui.snapEnabled}
          onChange={(event) => store.setSnapSize(Number(event.target.value))}
        >
          {[0.1, 0.25, 0.5, 1].map((size) => (
            <option key={size} value={size}>
              {size} m
            </option>
          ))}
        </select>
      </label>

      <h2 className="panel__title">Assembly</h2>
      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="input"
          value={ui.assemblyName}
          onChange={(event) => store.setAssemblyName(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button type="button" className="button" onClick={() => store.saveLocal()}>
          Save
        </button>
        <button type="button" className="button" onClick={() => store.loadLocal()}>
          Load
        </button>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="button"
          onClick={() => downloadJson(store.toJson(), ui.assemblyName)}
        >
          Export JSON
        </button>
        <button type="button" className="button" onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          store.loadJson(await file.text(), file.name);
        }}
      />

      <h2 className="panel__title">Scenes</h2>
      <div className="button-row button-row--stack">
        <button type="button" className="button" onClick={() => store.loadStarterAssembly()}>
          Starter assembly
        </button>
        <button type="button" className="button" onClick={() => store.loadOverloadDemo()}>
          Overload demo
        </button>
        <button type="button" className="button" onClick={() => store.clear()}>
          Clear workspace
        </button>
      </div>
    </section>
  );
}

function downloadJson(json: string, name: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[^\w.-]+/g, "-").toLowerCase() || "assembly"}.forgelab.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
