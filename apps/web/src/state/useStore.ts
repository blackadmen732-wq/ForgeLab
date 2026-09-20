import { useSyncExternalStore } from "react";
import { ForgeLabStore, type UiState } from "./store.js";

/**
 * The workspace's single store.
 *
 * A module singleton rather than React context on purpose: React Three Fiber renders the
 * 3D scene through its own reconciler root, and a context provider in the DOM tree does
 * not reliably cross that boundary. One workspace, one store, reachable from both trees.
 */
export const store = new ForgeLabStore();

export function useStore(): ForgeLabStore {
  return store;
}

/**
 * Subscribes React to the simulation.
 *
 * The engine publishes a new immutable UI state; React re-renders from it. React never
 * writes back, and nothing in the interface computes a physical quantity of its own.
 */
export function useUiState(): UiState {
  return useSyncExternalStore(store.subscribe, store.getUiState, store.getUiState);
}
