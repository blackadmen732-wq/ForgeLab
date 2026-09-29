import type { FailureEvent } from "@forgelab/sim-core";
import { SESSION_SPEEDS, type HistoryPoint, type SessionSpeed } from "@forgelab/sim-runner";
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { ConfidenceBadge } from "../../components/ConfidenceBadge.js";
import { duration, gain, kelvin, megawatts, si } from "../../lib/format.js";
import { useEditor, useEditorStore, useSim } from "../store/context.js";
import { OVERLAYS } from "../store/editor.js";

/* ------------------------------------------------------------------------------------ *
 * Sparklines
 * ------------------------------------------------------------------------------------ */

const Sparkline = memo(function Sparkline({
  history,
  pick,
  label,
  format,
  tone,
  zeroLine = false,
}: {
  history: readonly HistoryPoint[];
  pick: (p: HistoryPoint) => number;
  label: string;
  format: (v: number) => string;
  tone: string;
  zeroLine?: boolean;
}) {
  const { path, min, max, last } = useMemo(() => {
    const step = Math.max(1, Math.ceil(history.length / 240));
    const pts: number[] = [];
    for (let i = 0; i < history.length; i += step) pts.push(pick(history[i]!));
    if (history.length > 0 && (history.length - 1) % step !== 0)
      pts.push(pick(history[history.length - 1]!));
    let lo = Math.min(...pts, zeroLine ? 0 : Infinity);
    let hi = Math.max(...pts, zeroLine ? 0 : -Infinity);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    const W = 200;
    const H = 40;
    const d = pts
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`,
      )
      .join("");
    return { path: d, min: lo, max: hi, last: pts[pts.length - 1] ?? 0 };
  }, [history, pick, zeroLine]);
  const zeroY = 40 - ((0 - min) / (max - min)) * 40;
  return (
    <figure className="spark">
      <figcaption>
        <span>{label}</span>
        <strong className="num">{format(last)}</strong>
      </figcaption>
      <svg viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
        {zeroLine && min < 0 && max > 0 && (
          <line x1="0" x2="200" y1={zeroY} y2={zeroY} className="spark__zero" />
        )}
        <path
          d={path}
          className={`spark__line spark__line--${tone}`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
});

const pickNet = (p: HistoryPoint) => p.netElectricW;
const pickFusion = (p: HistoryPoint) => p.fusionPowerW;
const pickPeakT = (p: HistoryPoint) => p.peakTemperatureK;
const pickPlasmaT = (p: HistoryPoint) => p.plasmaTemperatureKeV;

/* ------------------------------------------------------------------------------------ *
 * Failures
 * ------------------------------------------------------------------------------------ */

function headline(f: FailureEvent): string {
  return f.summary ?? `${f.failureType.replace(/_/g, " ")} — ${f.componentId}`;
}

function FailureItem({
  failure,
  labelOf,
}: {
  failure: FailureEvent;
  labelOf: (id: string) => string;
}) {
  const store = useEditorStore();
  const [open, setOpen] = useState(false);
  const chain = failure.causalChain ?? [];
  return (
    <li className="failure">
      <button
        type="button"
        className="failure__main"
        onClick={() => store.focusComponent(failure.componentId)}
        title="Show in the workspace"
      >
        <TriangleAlert aria-hidden="true" />
        <span className="failure__time num">{duration(failure.timestampSec)}</span>
        <span className="failure__title">{headline(failure)}</span>
        <span className="failure__where dim">{labelOf(failure.componentId)}</span>
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        aria-expanded={open}
        aria-label="Why?"
        data-tip="Why did this happen?"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronUp /> : <ChevronDown />}
      </button>
      {open && (
        <div className="failure__detail">
          <p>{failure.cause}</p>
          <p className="dim num">
            {si(failure.measuredValue, failure.unit)} against a limit of{" "}
            {si(failure.limitValue, failure.unit)} ({(failure.utilization * 100).toFixed(0)}%)
          </p>
          {chain.length > 1 && (
            <ol className="chain" aria-label="Causal chain, root cause first">
              {chain.map((link, i) => (
                <li key={`${link.componentId}-${link.failureType}-${i}`}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => store.focusComponent(link.componentId)}
                  >
                    {link.summary}
                  </button>
                  <span className="dim"> · {link.system}</span>
                </li>
              ))}
            </ol>
          )}
          {failure.loadPathComponentIds.length > 1 && (
            <p className="dim">
              Load path:{" "}
              {failure.loadPathComponentIds.map((id, i) => (
                <span key={id}>
                  {i > 0 && " ← "}
                  <button type="button" className="link" onClick={() => store.focusComponent(id)}>
                    {labelOf(id)}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function FailureList({ failures }: { failures: readonly FailureEvent[] }) {
  const components = useEditor((v) => v.snapshot.components);
  const labels = useMemo(
    () => new Map(components.map((c) => [c.id, c.label || c.id])),
    [components],
  );
  const labelOf = (id: string) => labels.get(id) ?? id;
  if (failures.length === 0) {
    return <p className="dim timeline__none">No failures. Everything is within its limits.</p>;
  }
  // Newest first; roots of chains are visible in each event's own chain.
  return (
    <ol className="failures" aria-label="Failure events, newest first">
      {[...failures]
        .reverse()
        .slice(0, 200)
        .map((f, i) => (
          <FailureItem
            key={`${f.tick}-${f.componentId}-${f.failureType}-${i}`}
            failure={f}
            labelOf={labelOf}
          />
        ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------------------------ */

function speedLabel(s: SessionSpeed): string {
  return s === "max" ? "Max" : s === 0 ? "‖" : `${s}×`;
}

export function Timeline() {
  const store = useEditorStore();
  const mode = useEditor((v) => v.mode);
  const open = useEditor((v) => v.timelineOpen);
  const overlay = useEditor((v) => v.overlay);
  const staticFailures = useEditor((v) => v.snapshot.failures);
  const buildPlant = useEditor((v) => v.snapshot.plant);
  const count = useEditor((v) => v.snapshot.components.length);
  const sim = useSim();
  const simulating = mode === "simulate";
  const failures = simulating ? sim.failures : staticFailures;
  const plant = simulating && sim.plant !== null ? sim.plant : buildPlant;
  const m = plant.metrics;

  return (
    <section
      className={`timeline${open ? "" : " timeline--collapsed"}`}
      aria-label="Simulation timeline"
    >
      <div className="timeline__bar">
        <div className="transport">
          <button
            type="button"
            className={`btn btn--icon ${simulating && sim.speed !== 0 ? "" : "btn--primary"}`}
            aria-label={simulating && sim.speed !== 0 ? "Pause" : "Play"}
            data-tip="Play / pause (Space)"
            disabled={count === 0}
            onClick={store.togglePlay}
          >
            {simulating && sim.speed !== 0 ? <Pause /> : <Play />}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            aria-label="Step one tick"
            data-tip="Step 1/60 s (.)"
            disabled={!simulating}
            onClick={() => store.stepSimulation(1)}
          >
            <SkipForward />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            aria-label="Reset run"
            data-tip="Reset to t = 0 (Shift R)"
            disabled={!simulating}
            onClick={store.resetSimulation}
          >
            <RotateCcw />
          </button>
          <div className="segmented segmented--sm" role="radiogroup" aria-label="Speed">
            {SESSION_SPEEDS.filter((s) => s !== 0).map((s) => (
              <button
                key={String(s)}
                type="button"
                role="radio"
                aria-checked={simulating && sim.speed === s}
                className={simulating && sim.speed === s ? "is-active" : ""}
                onClick={() => store.setSpeed(s)}
              >
                {speedLabel(s)}
              </button>
            ))}
          </div>
          <span className="timeline__clock num" aria-label="Simulated time">
            {simulating ? duration(sim.timeSec) : "00:00.00"}
          </span>
          {simulating && sim.status === "loading" && (
            <span className="spinner" aria-label="Loading simulation" />
          )}
          {simulating && sim.droppedTimeSec > 1 && (
            <span
              className="badge"
              data-tip="The simulation could not keep up with the requested speed; it ran as fast as it could."
            >
              behind real time
            </span>
          )}
        </div>
        <div className="overlays" role="radiogroup" aria-label="Overlay">
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={overlay === o.id}
              className={`chip chip--${o.id}${overlay === o.id ? " is-active" : ""}`}
              data-tip={o.hint}
              onClick={() => store.setOverlay(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="timeline__end">
          <span
            className={`kpi-inline num ${m.netElectricW > 0 ? "pos" : m.netElectricW < 0 ? "neg" : ""}`}
            data-tip="Net electric = gross generation − house load"
          >
            <Zap aria-hidden="true" /> {megawatts(m.netElectricW)}
          </span>
          <ConfidenceBadge level={plant.confidence.level} />
          <span className={`badge ${failures.length > 0 ? "badge--fail" : ""}`}>
            {failures.length} failures
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label={open ? "Collapse timeline" : "Expand timeline"}
            aria-expanded={open}
            onClick={() => store.toggleTimeline()}
          >
            {open ? <ChevronDown /> : <ChevronUp />}
          </button>
        </div>
      </div>
      {open && (
        <div className="timeline__body">
          <div className="timeline__charts">
            {simulating ? (
              <>
                <Sparkline
                  history={sim.history}
                  pick={pickNet}
                  label="Net electric"
                  format={(v) => megawatts(v)}
                  tone="power"
                  zeroLine
                />
                <Sparkline
                  history={sim.history}
                  pick={pickFusion}
                  label="Fusion power"
                  format={(v) => megawatts(v)}
                  tone="plasma"
                />
                <Sparkline
                  history={sim.history}
                  pick={pickPlasmaT}
                  label="Plasma T"
                  format={(v) => `${v.toFixed(1)} keV`}
                  tone="plasma"
                />
                <Sparkline
                  history={sim.history}
                  pick={pickPeakT}
                  label="Peak temperature"
                  format={kelvin}
                  tone="heat"
                />
                <div className="timeline__kpis">
                  <span>
                    Gross <strong className="num">{megawatts(m.grossElectricW)}</strong>
                  </span>
                  <span>
                    House load <strong className="num">{megawatts(m.houseLoadW)}</strong>
                  </span>
                  <span>
                    Q <strong className="num">{gain(m.plasmaGainQ)}</strong>
                  </span>
                </div>
              </>
            ) : (
              <div className="timeline__idle">
                <p>
                  <strong>Build mode.</strong> Loads, stresses and the plant's start-up state update
                  as you edit. Press <kbd className="kbd">Tab</kbd> or <strong>SIMULATE</strong> to
                  run the design through time.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={count === 0}
                  onClick={() => store.startSimulation()}
                >
                  <Zap /> Simulate
                </button>
              </div>
            )}
          </div>
          <div className="timeline__failures">
            <h3>Failures &amp; causes</h3>
            <FailureList failures={failures} />
          </div>
        </div>
      )}
    </section>
  );
}
