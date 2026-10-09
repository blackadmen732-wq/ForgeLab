import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> =
  | { readonly status: "loading"; readonly data: T | undefined; readonly error: null }
  | { readonly status: "ready"; readonly data: T; readonly error: null }
  | { readonly status: "error"; readonly data: T | undefined; readonly error: Error };

interface Settled<T> {
  readonly key: string;
  readonly data: T | undefined;
  readonly error: Error | null;
}

/**
 * Runs an async loader when its dependencies change and ignores stale results. While a
 * new load is in flight the previous data stays available, so lists don't flash empty.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: readonly (string | number | boolean | null | undefined)[],
): AsyncState<T> & { reload(): void } {
  const [nonce, setNonce] = useState(0);
  // One key per request: results are only accepted for the request they answer.
  const key = `${JSON.stringify(deps)}#${nonce}`;
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (data) => {
        if (live) setSettled({ key, data, error: null });
      },
      (error: unknown) => {
        if (live) {
          setSettled((previous) => ({
            key,
            data: previous?.data,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
        }
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  let state: AsyncState<T>;
  if (settled === null || settled.key !== key)
    state = { status: "loading", data: settled?.data, error: null };
  else if (settled.error !== null)
    state = { status: "error", data: settled.data, error: settled.error };
  else state = { status: "ready", data: settled.data as T, error: null };
  return { ...state, reload };
}
