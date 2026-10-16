import { createContext, useContext, useSyncExternalStore } from "react";
import type { CollabController, CollabState } from "./controller.js";
import type { WorkOrderState } from "./workOrders.js";

export const CollabContext = createContext<CollabController | null>(null);

export function useCollabController(): CollabController | null {
  return useContext(CollabContext);
}

/** Subscribes to one slice of the team state; re-renders only when that slice changes. */
export function useCollab<T>(select: (state: CollabState) => T): T | undefined {
  const controller = useContext(CollabContext);
  return useSyncExternalStore(controller?.subscribe ?? noopSubscribe, () =>
    controller === null ? undefined : select(controller.getState()),
  );
}

const noopSubscribe = () => () => undefined;

export function useWorkOrders(): WorkOrderState | undefined {
  const work = useCollabController()?.work;
  return useSyncExternalStore(work?.subscribe ?? noopSubscribe, () => work?.getState());
}
