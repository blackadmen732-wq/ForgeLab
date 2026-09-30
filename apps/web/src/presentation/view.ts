import { useSyncExternalStore } from "react";

/**
 * Cinematic view: every panel hidden, the camera drifting slowly around the plant, only a
 * minimal status line left. Per viewer and per session; never saved.
 */
let cinematic = false;
const listeners = new Set<() => void>();

export function isCinematic(): boolean {
  return cinematic;
}

export function setCinematic(on: boolean): void {
  if (cinematic === on) return;
  cinematic = on;
  for (const listener of listeners) listener();
}

export function toggleCinematic(): void {
  setCinematic(!cinematic);
}

export function useCinematic(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isCinematic,
    () => false,
  );
}

/** Browser fullscreen for the whole page; a no-op where the API is missing. */
export function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen is not available (iframe without permission, old browser).
  }
}
