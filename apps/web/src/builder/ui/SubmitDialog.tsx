import {
  LEADERBOARD_CATEGORIES,
  STANDARD_SCENARIO,
  type VerificationResult,
} from "@forgelab/sim-runner";
import { FlaskConical, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ConfidenceBadge } from "../../components/ConfidenceBadge.js";
import { Dialog } from "../../components/Dialog.js";
import { requestVerification, type VerifyResponse } from "../../lib/api.js";
import { mass, megawatts } from "../../lib/format.js";
import { errorMessage, toast } from "../../lib/toast.js";
import { formatScore } from "../../pages/Leaderboards.js";
import { previewVerification } from "../sim/client.js";
import { useEditor, useEditorStore } from "../store/context.js";

type Scores = readonly {
  category: string;
  value: number;
  eligible: boolean;
  reason?: string;
  entered?: boolean;
}[];

function ScoreTable({ scores }: { scores: Scores }) {
  return (
    <table className="table">
      <tbody>
        {scores.map((s) => (
          <tr key={s.category}>
            <td>{LEADERBOARD_CATEGORIES.find((c) => c.id === s.category)?.name ?? s.category}</td>
            <td className="num num-col">{s.eligible ? formatScore(s.category, s.value) : "—"}</td>
            <td className="dim">
              {s.eligible
                ? s.entered === undefined
                  ? "eligible"
                  : s.entered
                    ? "entered"
                    : "not a personal best"
                : s.reason}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Leaderboard submission. The browser can preview the standard run locally, but only the
 * server's recomputation — from the saved version, not from anything this page sends —
 * is ever ranked.
 */
export function SubmitDialog() {
  const store = useEditorStore();
  const cloud = useEditor((v) => v.cloud);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<VerificationResult | null>(null);
  const [verified, setVerified] = useState<VerifyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const close = () => {
    cancel.current?.();
    store.openDialog(null);
  };
  useEffect(() => () => cancel.current?.(), []);

  const runPreview = async () => {
    setProgress(0);
    setPreview(null);
    const job = previewVerification(store.exportFile(), setProgress);
    cancel.current = job.cancel;
    try {
      setPreview(await job.promise);
    } catch (error) {
      if (errorMessage(error) !== "Cancelled.")
        toast("error", "Preview failed", errorMessage(error));
    } finally {
      cancel.current = null;
      setProgress(null);
    }
  };

  const submit = async () => {
    if (cloud === null) return;
    setBusy(true);
    try {
      await store.cloud.flush();
      const versionId = store.cloud.binding?.latestVersionId;
      if (!versionId) throw new Error("Save the design first.");
      setVerified(await requestVerification(cloud.projectId, versionId));
      toast("success", "Verified", "The server reran your design and recorded the result.");
    } catch (error) {
      toast("error", "Verification failed", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = cloud !== null && !cloud.readOnly && cloud.visibility === "public";
  return (
    <Dialog title="Submit a score" onClose={close} wide>
      <p>
        Scores come from the <strong>{STANDARD_SCENARIO.name}</strong>:{" "}
        {STANDARD_SCENARIO.durationSec / 60} simulated minutes from the design's saved start state,
        averaged over the last {STANDARD_SCENARIO.averagingWindowSec} s. The server reruns your
        saved version with the same engine and records only what it computes. Experimental designs
        are not ranked.
      </p>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={progress !== null}
          onClick={() => void runPreview()}
        >
          <FlaskConical /> Preview locally
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canSubmit || busy}
          onClick={() => void submit()}
        >
          <ShieldCheck /> {busy ? "Verifying on the server…" : "Submit for verification"}
        </button>
        {!canSubmit && (
          <span className="dim">
            {cloud === null
              ? "Save to the cloud first."
              : cloud.readOnly
                ? "Fork this design to submit it."
                : "Publish the design first — leaderboards list public designs."}
          </span>
        )}
      </div>
      {progress !== null && (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress__fill" style={{ width: `${progress * 100}%` }} />
          <span>
            Running the standard scenario in a background thread… {Math.round(progress * 100)}%
          </span>
        </div>
      )}
      {preview !== null && (
        <section className="stack">
          <h3>
            Local preview <span className="badge">not ranked</span>
          </h3>
          <div className="row">
            <ConfidenceBadge level={preview.confidence} />
            <span className="dim">
              Net {megawatts(preview.averages.netElectricW)} · fusion{" "}
              {megawatts(preview.averages.fusionPowerW)} · mass {mass(preview.totalMassKg)} ·{" "}
              {preview.failureCount} failures
            </span>
          </div>
          <ScoreTable scores={preview.scores} />
        </section>
      )}
      {verified !== null && (
        <section className="stack">
          <h3>
            <ShieldCheck aria-hidden="true" className="inline-icon" /> Server-verified
          </h3>
          <ScoreTable scores={verified.scores} />
          <Link className="btn btn--sm" to="/leaderboards">
            Open leaderboards
          </Link>
        </section>
      )}
    </Dialog>
  );
}
