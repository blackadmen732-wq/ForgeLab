import { Clapperboard, Hammer, Pause, Play, RotateCcw, ScanSearch, X } from "lucide-react";
import { useContext, useEffect, useMemo, useRef } from "react";
import type { FailureEvent } from "@forgelab/sim-core";
import { CINEMA_RATES, useCinema, type CinemaCamera } from "../../presentation/cinema.js";
import { CinemaContext } from "../../presentation/context.js";
import { getSettings } from "../../presentation/settings.js";
import { useEditorStore, useSim } from "../store/context.js";

/**
 * Failure cinema controls and the causal chain. The chain is the simulation's own: each
 * step is a raised failure, root first, exactly as the solver linked them.
 */

interface ChainStep {
  readonly componentId: string;
  readonly summary: string;
  readonly failureType: string;
  readonly timeSec: number | undefined;
}

/** The longest causal chain among raised failures (latest wins ties), root first. */
export function rootCauseChain(failures: readonly FailureEvent[]): ChainStep[] {
  let best: FailureEvent | undefined;
  for (const f of failures) {
    const length = f.causalChain?.length ?? 1;
    if (best === undefined || length >= (best.causalChain?.length ?? 1)) best = f;
  }
  if (best === undefined) return [];
  const links = best.causalChain ?? [
    {
      componentId: best.componentId,
      system: best.system,
      failureType: best.failureType,
      summary: best.summary ?? best.failureType,
    },
  ];
  return links.map((link) => ({
    componentId: link.componentId,
    summary: link.summary,
    failureType: link.failureType,
    timeSec: failures.find(
      (f) => f.componentId === link.componentId && f.failureType === link.failureType,
    )?.timestampSec,
  }));
}

export function RootCauseChain() {
  const store = useEditorStore();
  const cinema = useContext(CinemaContext);
  const failures = useSim((s) => s.failures);
  const chain = useMemo(() => rootCauseChain(failures), [failures]);
  const root = chain[0]?.componentId;
  // Optional diagnostic cutaway: once per root cause, select it and cut it open. The
  // camera stays where the player put it.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (root === undefined) {
      opened.current = null;
      return;
    }
    if (opened.current === root || !getSettings().autoCutaway) return;
    opened.current = root;
    store.select([root]);
    store.toggleCutaway(true);
  }, [root, store]);
  if (chain.length === 0) return null;
  return (
    <nav className="root-cause" aria-label="Failure chain, root cause first">
      <span className="root-cause__label">Root cause</span>
      <ol>
        {chain.map((step, i) => (
          <li key={`${step.componentId}-${step.failureType}`}>
            <button
              type="button"
              className={i === 0 ? "root-cause__step root-cause__step--root" : "root-cause__step"}
              title={`Show ${step.componentId}${step.timeSec !== undefined ? ` at ${step.timeSec.toFixed(2)} s` : ""}`}
              onClick={() => {
                store.select([step.componentId]);
                store.focusComponent(step.componentId);
                if (cinema?.getState().active) cinema.focus(step.componentId, step.timeSec);
              }}
            >
              {step.summary}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn btn--sm root-cause__watch"
        title="Select the root-cause part, cut it open and frame it"
        onClick={() => {
          store.select([root!]);
          store.toggleCutaway(true);
          store.focusComponent(root!);
        }}
      >
        <ScanSearch /> Look inside
      </button>
      {cinema !== null && <WatchButton />}
    </nav>
  );
}

function WatchButton() {
  const cinema = useContext(CinemaContext)!;
  const active = useCinema(cinema, (s) => s.active);
  if (active) return null;
  return (
    <button
      type="button"
      className="btn btn--sm root-cause__watch"
      onClick={() => cinema.open()}
      disabled={!cinema.canOpen}
    >
      <Clapperboard /> Watch failure
    </button>
  );
}

const CAMERA_LABELS: Readonly<Record<CinemaCamera, string>> = {
  free: "Free",
  follow: "Follow",
  root: "Root cause",
};

export function FailureCinemaPanel() {
  const store = useEditorStore();
  const cinema = useContext(CinemaContext);
  const state = useCinema(cinema!, (s) => s);
  if (cinema === null || !state.active) return null;
  const span = Math.max(1e-6, state.endSec - state.startSec);
  return (
    <section className="cinema" aria-label="Failure replay">
      <div className="cinema__row">
        <span className="cinema__badge">Replay</span>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label={state.playing ? "Pause" : "Play"}
          onClick={() => cinema.togglePlay()}
        >
          {state.playing ? <Pause /> : <Play />}
        </button>
        <div className="segmented" role="group" aria-label="Replay speed">
          {CINEMA_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              className={state.rate === rate ? "is-active" : ""}
              aria-pressed={state.rate === rate}
              onClick={() => cinema.setRate(rate)}
            >
              {rate}×
            </button>
          ))}
        </div>
        <span className="cinema__time mono">{state.timeSec.toFixed(2)} s</span>
        <div className="segmented" role="group" aria-label="Replay camera">
          {(Object.keys(CAMERA_LABELS) as CinemaCamera[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={state.camera === mode ? "is-active" : ""}
              aria-pressed={state.camera === mode}
              onClick={() => cinema.setCamera(mode)}
            >
              {CAMERA_LABELS[mode]}
            </button>
          ))}
        </div>
        <span className="cinema__spacer" />
        <button type="button" className="btn btn--sm" onClick={() => store.resetSimulation()}>
          <RotateCcw /> Reset run
        </button>
        <button type="button" className="btn btn--sm" onClick={() => store.stopSimulation()}>
          <Hammer /> Return to Build
        </button>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label="Exit replay"
          onClick={() => cinema.close()}
        >
          <X />
        </button>
      </div>
      <div className="cinema__track">
        <input
          type="range"
          aria-label="Replay position"
          min={state.startSec}
          max={state.endSec}
          step={0.01}
          value={state.timeSec}
          onChange={(e) => cinema.seek(Number(e.target.value))}
        />
        {state.markers.map((m, i) => (
          <span
            key={i}
            className={`cinema__marker cinema__marker--${m.family}`}
            style={{ left: `${((m.timeSec - state.startSec) / span) * 100}%` }}
            title={`${m.timeSec.toFixed(2)} s — ${m.summary}`}
          />
        ))}
      </div>
    </section>
  );
}
