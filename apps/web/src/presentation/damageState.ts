/**
 * Parts that broke up this run (their destruction event was fractured and debris was
 * thrown). Run-state presentation only: cleared on reset, never saved with the design.
 */
const fractured = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version += 1;
  for (const l of listeners) l();
};

export const damageState = {
  isFractured: (componentId: string): boolean => fractured.has(componentId),
  /** Changes whenever the set does (for useSyncExternalStore). */
  version: (): number => version,
  markFractured(componentId: string): void {
    if (fractured.has(componentId)) return;
    fractured.add(componentId);
    changed();
  },
  clear(): void {
    if (fractured.size === 0) return;
    fractured.clear();
    changed();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
