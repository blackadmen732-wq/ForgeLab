import { SimulationSession, type SessionCommand, type SessionEvent } from "@forgelab/sim-runner";

/**
 * The simulation thread. It only forwards messages: all pacing and physics live in
 * `SimulationSession` (sim-runner), which runs sim-core. Nothing here computes physics.
 */
// The app compiles against the DOM library; this is the slice of the worker scope we use.
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const session = new SimulationSession(() => performance.now());
let last = performance.now();

function post(events: readonly SessionEvent[]): void {
  for (const event of events) {
    if (event.type === "frame") {
      scope.postMessage(event, [event.transforms.buffer, event.scalars.buffer]);
    } else {
      scope.postMessage(event);
    }
  }
}

scope.onmessage = (message: MessageEvent<SessionCommand>) => {
  try {
    post(session.handle(message.data));
  } catch (error) {
    scope.postMessage({
      type: "error",
      runId: -1,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function pump(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  try {
    const frame = session.tick(dt);
    if (frame !== null) post([frame]);
  } catch (error) {
    scope.postMessage({
      type: "error",
      runId: -1,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  // A macrotask loop: messages (pause, speed) are handled between ticks.
  setTimeout(pump, 8);
}
pump();
