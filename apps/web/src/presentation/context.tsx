import { createContext, useContext, useSyncExternalStore } from "react";
import type { AudioEngine } from "./audio/engine.js";
import type { FailureCinema } from "./cinema.js";
import type { PresentationDirector, PresentationState } from "./director.js";

export const PresentationContext = createContext<PresentationDirector | null>(null);
export const AudioEngineContext = createContext<AudioEngine | null>(null);
export const CinemaContext = createContext<FailureCinema | null>(null);

export function useDirector(): PresentationDirector {
  const director = useContext(PresentationContext);
  if (director === null) throw new Error("useDirector must be used inside the builder.");
  return director;
}

/** Subscribes to presentation state; pass a selector to re-render only on that slice. */
export function usePresentation<T = PresentationState>(
  selector?: (state: PresentationState) => T,
): T {
  const director = useDirector();
  return useSyncExternalStore(director.subscribe, () => {
    const state = director.getState();
    return selector === undefined ? (state as T) : selector(state);
  });
}
