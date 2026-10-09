import { useSyncExternalStore } from "react";

/**
 * Cracks in the camera's protective glass. One is added only when a simulated debris
 * fragment actually strikes the camera guard collider above the crack speed; it
 * originates where that fragment projects on screen and lasts until the run is reset.
 */
export interface Crack {
  readonly id: number;
  /** Screen position, 0..1 of the viewport. */
  readonly x: number;
  readonly y: number;
  /** 0..1 from impact speed. */
  readonly strength: number;
  readonly seed: number;
}

let cracks: readonly Crack[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function addCrack(x: number, y: number, strength: number): void {
  if (cracks.length >= 6) return;
  cracks = [...cracks, { id: next, x, y, strength, seed: next * 7919 }];
  next += 1;
  emit();
}

export function clearCracks(): void {
  if (cracks.length === 0) return;
  cracks = [];
  emit();
}

export function getCracks(): readonly Crack[] {
  return cracks;
}

export function useCracks(): readonly Crack[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCracks,
    () => cracks,
  );
}
