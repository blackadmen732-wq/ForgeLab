import { useSyncExternalStore } from "react";

/**
 * The internal region picked in the Inspector's Inside list. Cutaway shows it lit and
 * the part's other regions faded, so a material in the list can be found in the part.
 */
export interface RegionHighlight {
  readonly componentId: string;
  readonly regionId: string;
}

let current: RegionHighlight | null = null;
const listeners = new Set<() => void>();

export const regionHighlight = {
  get: (): RegionHighlight | null => current,
  set(next: RegionHighlight | null): void {
    if (next?.componentId === current?.componentId && next?.regionId === current?.regionId) return;
    current = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useRegionHighlight(): RegionHighlight | null {
  return useSyncExternalStore(regionHighlight.subscribe, regionHighlight.get, regionHighlight.get);
}
