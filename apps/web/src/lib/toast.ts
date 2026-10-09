import { useSyncExternalStore } from "react";

/** Toast notifications, callable from React and from plain TypeScript stores alike. */
export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly title: string;
  readonly body?: string;
}

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function toast(
  kind: ToastKind,
  title: string,
  body?: string,
  durationMs = kind === "error" ? 8000 : 4000,
): number {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, kind, title, ...(body === undefined ? {} : { body }) }];
  emit();
  if (durationMs > 0) setTimeout(() => dismissToast(id), durationMs);
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
    () => toasts,
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
