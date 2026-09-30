import { Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { safeStorage } from "../../lib/storage.js";
import { useEditor, useSim } from "../store/context.js";

const DISMISSED_KEY = "forgelab.hints.dismissed";

interface Hint {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Contextual onboarding hints. They read the editor state and suggest the next useful
 * step; for the interactive starter they walk through run → fail → understand → fix.
 */
export function Hints() {
  const view = useEditor();
  // Selectors return primitives so the subscription only re-renders on real changes.
  const failureCount = useSim((s) => s.failures.length);
  const time = useSim((s) => Math.floor(s.timeSec));
  const lossOfFlow = useSim((s) => s.failures.some((f) => f.failureType === "loss_of_flow"));
  const sim = { failures: failureCount, time, lossOfFlow };
  const [dismissed, setDismissed] = useState<string[]>(() =>
    safeStorage.getJson<string[]>(DISMISSED_KEY, []),
  );
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    safeStorage.setJson(DISMISSED_KEY, next);
  };

  const count = view.snapshot.components.length;
  const simulating = view.mode === "simulate";
  let hint: Hint | null = null;

  if (view.blueprintId === "interactive-starter") {
    const pump = view.snapshot.components.find((c) => c.id === "pump");
    const pumpOn = pump?.parameters["enabled"] === true;
    if (!pumpOn && !simulating && sim.failures === 0)
      hint = {
        id: "starter-1",
        title: "1 · Run the plant",
        body: "This fusion plant is almost ready. Press ACTIVATE (or Tab), then pick 10× in the controls at the bottom to watch the first minutes quickly.",
      };
    else if (!pumpOn && simulating && sim.failures === 0)
      hint = {
        id: "starter-2",
        title: "2 · Watch the plant",
        body: "The plasma heats up and burns. Keep an eye on the failure list and the Temperature overlay — something is about to go wrong.",
      };
    else if (!pumpOn && simulating)
      hint = {
        id: "starter-3",
        title: "3 · Read the cause",
        body: "Open a failure with the ▾ button to see its causal chain, root cause first. Click an entry to fly to the part. Which part started it?",
      };
    else if (!pumpOn)
      hint = {
        id: "starter-4",
        title: "4 · Fix it",
        body: "The primary coolant pump was switched off. In Build mode, click the Primary Pump (or press Ctrl K and type “pump”) and turn Enabled on in the inspector.",
      };
    else if (!simulating)
      hint = {
        id: "starter-5",
        title: "5 · Run it again",
        body: "Coolant now carries the heat to the steam generator and turbine. Simulate again and compare the net electric figure — then try to make it positive.",
      };
    else if (sim.time > 30 && !sim.lossOfFlow)
      hint = {
        id: "starter-6",
        title: "Nice work",
        body: "The loop is flowing. Save your design to keep it, publish it to share it, and submit a score when it makes net power.",
      };
  } else if (count === 0 && !simulating) {
    hint = {
      id: "empty",
      title: "An empty workspace",
      body: "Open the parts drawer (A), then click a part to place it or drag it in. Sockets snap together; hold Alt to place freely. Want a head start? Load a blueprint from the drawer.",
    };
  } else if (count > 0 && count < 3 && view.selection.length === 0 && !simulating) {
    hint = {
      id: "select",
      title: "Inspect a part",
      body: "Click a part to see its loads, temperatures and settings in the inspector. Change its material or size and the numbers update immediately.",
    };
  } else if (count >= 2 && !simulating) {
    hint = {
      id: "simulate",
      title: "Run it",
      body: "Press ACTIVATE to start the plant: the strip at the top follows each stage as the physics reaches it. Failures open the engineering overlay (T) with their causes; K hides everything but the plant.",
    };
  } else if (simulating && sim.failures > 0) {
    hint = {
      id: "failures",
      title: "Something failed",
      body: "Click a failure to fly to it; open it to see the causal chain. Return to Build (Tab) to fix it and run again.",
    };
  }

  if (hint === null || dismissed.includes(hint.id)) return null;
  return (
    <aside className="hint" role="note" aria-live="polite">
      <Lightbulb aria-hidden="true" />
      <div>
        <strong>{hint.title}</strong>
        <p>{hint.body}</p>
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-label="Dismiss hint"
        onClick={() => dismiss(hint.id)}
      >
        <X />
      </button>
    </aside>
  );
}
