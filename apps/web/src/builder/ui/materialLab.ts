import { useSyncExternalStore } from "react";

/**
 * The Material Lab's open state, outside the editor store: browsing materials changes
 * nothing about the design. One material is shown; a second can be compared with it.
 */
export interface MaterialLabState {
  readonly open: boolean;
  readonly materialId: string;
  readonly compareId: string | null;
}

let state: MaterialLabState = { open: false, materialId: "structural-steel", compareId: null };
const listeners = new Set<() => void>();
const set = (next: MaterialLabState) => {
  state = next;
  for (const l of listeners) l();
};

export const materialLab = {
  get: (): MaterialLabState => state,
  open(materialId?: string): void {
    set({ ...state, open: true, materialId: materialId ?? state.materialId });
  },
  toggle(): void {
    set({ ...state, open: !state.open });
  },
  close(): void {
    if (state.open) set({ ...state, open: false });
  },
  select(materialId: string): void {
    set({
      ...state,
      materialId,
      compareId: state.compareId === materialId ? null : state.compareId,
    });
  },
  compare(compareId: string | null): void {
    set({ ...state, compareId: compareId === state.materialId ? null : compareId });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useMaterialLab(): MaterialLabState {
  return useSyncExternalStore(materialLab.subscribe, materialLab.get, materialLab.get);
}
