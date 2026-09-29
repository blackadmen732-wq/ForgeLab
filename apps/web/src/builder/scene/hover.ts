import { useSyncExternalStore } from "react";

/** What the pointer is over in the viewport. Kept outside the editor store: it changes constantly. */
export interface HoverTarget {
  readonly componentId: string;
  readonly socket?: { readonly id: string; readonly type: string };
}

let current: HoverTarget | null = null;
const listeners = new Set<() => void>();

export const hover = {
  get: (): HoverTarget | null => current,
  set(next: HoverTarget | null): void {
    if (next?.componentId === current?.componentId && next?.socket?.id === current?.socket?.id)
      return;
    current = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useHover(): HoverTarget | null {
  return useSyncExternalStore(hover.subscribe, hover.get, hover.get);
}
