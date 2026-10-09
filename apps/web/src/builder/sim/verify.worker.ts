import { runVerification, STANDARD_SCENARIO } from "@forgelab/sim-runner";

/**
 * Runs the leaderboard's standard scenario locally, as a preview. The result is shown to
 * the player only; the leaderboard accepts nothing but the server's own recomputation.
 */
// The app compiles against the DOM library; this is the slice of the worker scope we use.
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

scope.onmessage = (message: MessageEvent<{ file: unknown }>) => {
  try {
    let lastReported = -1;
    const result = runVerification(message.data.file, {
      onProgress: (sec) => {
        const pct = Math.floor((sec / STANDARD_SCENARIO.durationSec) * 100);
        if (pct !== lastReported) {
          lastReported = pct;
          scope.postMessage({ type: "progress", fraction: sec / STANDARD_SCENARIO.durationSec });
        }
      },
    });
    scope.postMessage({ type: "result", result });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
