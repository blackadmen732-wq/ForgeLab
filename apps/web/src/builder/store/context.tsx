import { createContext, useContext, useSyncExternalStore } from "react";
import type { EditorStore, EditorView, SimView } from "./editor.js";

export const EditorContext = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext);
  if (store === null) throw new Error("useEditorStore must be used inside the builder.");
  return store;
}

/**
 * Subscribes to the editor view. Pass a selector returning a primitive or a reference held
 * by the view to re-render only when that slice changes.
 */
export function useEditor<T = EditorView>(selector?: (view: EditorView) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(store.subscribe, () => {
    const view = store.getView();
    return selector === undefined ? (view as T) : selector(view);
  });
}

/** Subscribes to the running simulation (updates with every frame, ≤ 20 Hz). */
export function useSim<T = SimView>(selector?: (sim: SimView) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(store.subscribeSim, () => {
    const sim = store.getSim();
    return selector === undefined ? (sim as T) : selector(sim);
  });
}
