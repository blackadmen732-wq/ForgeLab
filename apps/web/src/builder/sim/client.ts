import type { AssemblyFileV2 } from "@forgelab/sim-core";
import type {
  SessionCommand,
  SessionEvent,
  SessionSpeed,
  VerificationResult,
} from "@forgelab/sim-runner";

/** Main-thread handle on the simulation worker. */
export class SimulationClient {
  #worker: Worker;
  #runId = 0;
  #onEvent: (event: SessionEvent) => void;

  constructor(onEvent: (event: SessionEvent) => void) {
    this.#onEvent = onEvent;
    this.#worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
      type: "module",
      name: "forgelab-sim",
    });
    this.#worker.onmessage = (message: MessageEvent<SessionEvent>) => {
      const event = message.data;
      if (event.runId !== -1 && event.runId !== this.#runId) return; // stale run
      this.#onEvent(event);
    };
    this.#worker.onerror = (error) => {
      this.#onEvent({
        type: "error",
        runId: this.#runId,
        message: error.message || "The simulation worker crashed.",
      });
    };
  }

  #send(command: SessionCommand): void {
    this.#worker.postMessage(command);
  }

  load(file: AssemblyFileV2): number {
    this.#runId += 1;
    this.#send({ type: "load", runId: this.#runId, file });
    return this.#runId;
  }

  speed(speed: SessionSpeed): void {
    this.#send({ type: "speed", speed });
  }

  step(count: number): void {
    this.#send({ type: "step", count });
  }

  reset(): void {
    this.#send({ type: "reset" });
  }

  inspect(componentId: string | null): void {
    this.#send({ type: "inspect", componentId });
  }

  dispose(): void {
    this.#worker.terminate();
  }
}

/** Runs the standard verification scenario in a throwaway worker. */
export function previewVerification(
  file: AssemblyFileV2,
  onProgress: (fraction: number) => void,
): { promise: Promise<VerificationResult>; cancel(): void } {
  const worker = new Worker(new URL("./verify.worker.ts", import.meta.url), {
    type: "module",
    name: "forgelab-verify",
  });
  let settle: ((value: VerificationResult) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const promise = new Promise<VerificationResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  worker.onmessage = (
    message: MessageEvent<
      | { type: "progress"; fraction: number }
      | { type: "result"; result: VerificationResult }
      | { type: "error"; message: string }
    >,
  ) => {
    const data = message.data;
    if (data.type === "progress") onProgress(data.fraction);
    else if (data.type === "result") {
      settle?.(data.result);
      worker.terminate();
    } else {
      fail?.(new Error(data.message));
      worker.terminate();
    }
  };
  worker.onerror = (error) => {
    fail?.(new Error(error.message || "The verification worker crashed."));
    worker.terminate();
  };
  worker.postMessage({ file });
  return {
    promise,
    cancel() {
      worker.terminate();
      fail?.(new Error("Cancelled."));
    },
  };
}
