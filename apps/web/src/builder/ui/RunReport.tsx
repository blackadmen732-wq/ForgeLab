import { Clapperboard, Hammer, Play, Trophy, X } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { formatQuantity } from "@forgelab/sim-core";
import { fmtW } from "../../presentation/activation.js";
import { getBests, saveBests } from "../../presentation/bests.js";
import { CinemaContext, useDirector, usePresentation } from "../../presentation/context.js";
import {
  mergeBests,
  type BestKey,
  type Bests,
  type RunReport,
} from "../../presentation/runReport.js";
import { useEditor, useEditorStore, useSim } from "../store/context.js";

/**
 * The run report. Opens when a run finishes (a failure has settled, or every plasma has
 * ended) and on request. Figures are the simulation's; "best" is the largest published
 * value seen for this design in this browser. The root failure is shown with the value
 * that crossed its limit and the solver's explanation — the report does not suggest a
 * fix; Fix it takes the player back to Build with that part selected.
 */
export function designKey(
  cloud: { projectId: string } | null,
  blueprintId: string | null,
  name: string,
): string {
  if (cloud !== null) return `project:${cloud.projectId}`;
  if (blueprintId !== null) return `blueprint:${blueprintId}`;
  return `local:${name}`;
}

const fmtSec = (s: number) =>
  s >= 120 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`;
const fmtQ = (q: number) => (q > 0 ? q.toFixed(2) : "—");
const pct = (x: number) => `${Math.round(x * 100)} %`;

function Figure({
  label,
  value,
  best,
  isNew,
}: {
  label: string;
  value: string;
  best?: string | undefined;
  isNew?: boolean;
}) {
  return (
    <div className={`report__figure${isNew ? " report__figure--best" : ""}`}>
      <span className="report__label">{label}</span>
      <span className="report__value mono">{value}</span>
      {isNew ? (
        <span className="report__best">
          <Trophy aria-hidden /> New best
        </span>
      ) : (
        best !== undefined && <span className="report__prior">best {best}</span>
      )}
    </div>
  );
}

export function RunReportPanel() {
  const store = useEditorStore();
  const director = useDirector();
  const cinema = useContext(CinemaContext);
  const mode = usePresentation((s) => s.mode);
  const runEnded = usePresentation((s) => s.runEnded);
  const replaying = usePresentation((s) => s.replaying);
  const epoch = usePresentation((s) => s.runEpoch);
  const failures = useSim((s) => s.failures);
  const cloud = useEditor((v) => v.cloud);
  const blueprintId = useEditor((v) => v.blueprintId);
  const name = useEditor((v) => v.name);
  const key = designKey(cloud, blueprintId, name);
  // Open for one run: a new run (reset, or leaving Simulate) closes it.
  const [openEpoch, setOpenEpoch] = useState<number | null>(null);
  const open = openEpoch === epoch;
  const setOpen = (value: boolean) => setOpenEpoch(value ? director.getState().runEpoch : null);
  const [snapshot, setSnapshot] = useState<{
    report: RunReport;
    before: Bests;
    improved: readonly BestKey[];
  } | null>(null);
  const shownFor = useRef(-1);

  const show = () => {
    const report = director.runReport();
    const before = getBests(key);
    const { bests, improved } = mergeBests(before, report);
    saveBests(key, bests);
    setSnapshot({ report, before, improved });
    setOpen(true);
  };

  // Open once per run when it finishes.
  useEffect(() => {
    if (mode !== "simulate" || !runEnded || replaying || shownFor.current === epoch) return;
    shownFor.current = epoch;
    const t = setTimeout(show, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, runEnded, replaying, epoch]);

  const root = snapshot?.report.rootFailure ?? null;
  const rootEvent = useMemo(
    () => (root === null ? undefined : failures.find((f) => f.componentId === root.componentId)),
    [failures, root],
  );

  if (mode !== "simulate") return null;
  if (!open || snapshot === null || replaying)
    return (
      <button type="button" className="report-toggle btn btn--sm" onClick={show}>
        <Trophy /> Run report
      </button>
    );
  const { report, before, improved } = snapshot;
  const isNew = (k: BestKey) => improved.includes(k);
  const fix = () => {
    if (root === null) return;
    store.stopSimulation();
    store.select([root.componentId]);
    store.focusComponent(root.componentId);
  };
  return (
    <section className="report" role="dialog" aria-label="Run report">
      <header className="report__head">
        <h2>Run report</h2>
        <span className={`report__verdict report__verdict--${report.clean ? "ok" : "fail"}`}>
          {report.clean
            ? "No failures"
            : `${report.failureCount} failure${report.failureCount === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label="Close report"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
      </header>
      <div className="report__grid">
        <Figure label="Runtime" value={fmtSec(report.runtimeSec)} />
        <Figure label="Plasma" value={fmtSec(report.plasmaSec)} />
        <Figure
          label="Burn (flat-top)"
          value={fmtSec(report.burnSec)}
          best={before.longestBurnSec > 0 ? fmtSec(before.longestBurnSec) : undefined}
          isNew={isNew("longestBurnSec")}
        />
        <Figure
          label="Peak fusion"
          value={fmtW(report.peakFusionW)}
          best={before.peakFusionW > 0 ? fmtW(before.peakFusionW) : undefined}
          isNew={isNew("peakFusionW")}
        />
        <Figure
          label="Peak Q"
          value={fmtQ(report.peakGainQ)}
          best={before.peakGainQ > 0 ? fmtQ(before.peakGainQ) : undefined}
          isNew={isNew("peakGainQ")}
        />
        <Figure label="Peak gross electric" value={fmtW(report.peakGrossElectricW)} />
        <Figure label="House load (mean)" value={fmtW(report.meanHouseLoadW)} />
        <Figure
          label="Net electric (mean, burning)"
          value={report.meanNetElectricBurnW === null ? "—" : fmtW(report.meanNetElectricBurnW)}
          best={before.bestMeanNetW === null ? undefined : fmtW(before.bestMeanNetW)}
          isNew={isNew("bestMeanNetW")}
        />
      </div>
      <div className="report__margins">
        {report.thermalMargin !== null && (
          <p>
            <span className="report__label">Closest to a temperature limit</span>{" "}
            <strong>{report.thermalMargin.componentId}</strong> at{" "}
            {pct(report.thermalMargin.fraction)} of its limit (
            {report.thermalMargin.atSec.toFixed(1)} s)
          </p>
        )}
        {report.structuralMargin !== null && (
          <p>
            <span className="report__label">Closest to a structural limit</span>{" "}
            <strong>{report.structuralMargin.componentId}</strong> at{" "}
            {pct(report.structuralMargin.fraction)} ({report.structuralMargin.atSec.toFixed(1)} s)
          </p>
        )}
      </div>
      {root !== null && (
        <div className="report__root">
          <p className="report__label">Root failure · {root.atSec.toFixed(2)} s</p>
          <p className="report__summary">{root.summary}</p>
          {rootEvent !== undefined && (
            <>
              <p className="mono report__measured">
                measured {formatQuantity(rootEvent.measuredValue, rootEvent.unit)} · limit{" "}
                {formatQuantity(rootEvent.limitValue, rootEvent.unit)}
              </p>
              <p className="report__cause">{rootEvent.cause}</p>
            </>
          )}
        </div>
      )}
      <footer className="report__actions">
        {root !== null && (
          <button type="button" className="btn btn--primary" onClick={fix}>
            <Hammer /> Fix it — back to Build with {root.componentId} selected
          </button>
        )}
        {root !== null && cinema !== null && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setOpen(false);
              cinema.open();
            }}
          >
            <Clapperboard /> Watch failure
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOpen(false);
            store.resetSimulation();
            store.setSpeed(1);
          }}
        >
          <Play /> Run again
        </button>
      </footer>
    </section>
  );
}
