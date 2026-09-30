import { Check, Circle, Loader, X } from "lucide-react";
import { fmtW, type StageProgress } from "../../presentation/activation.js";
import { usePresentation } from "../../presentation/context.js";
import type { FacilityState } from "../../presentation/facility.js";
import { setCinematic, useCinematic } from "../../presentation/view.js";

/**
 * The activation strip: each commissioning stage as the physics reaches it, and the
 * facility state. Every word under a stage is either a measured value or the solver's own
 * explanation — the strip never claims progress the simulation has not published.
 */
const FACILITY_LABEL: Readonly<Record<FacilityState, string>> = {
  BUILD: "Build",
  READY: "Ready",
  STARTUP: "Start-up",
  RUNNING: "Running",
  WARNING: "Warning",
  POWER_LOSS: "Power loss",
  EMERGENCY: "Emergency",
  FAILURE: "Failure",
  POST_FAILURE: "Post-failure",
};

function StageIcon({ stage }: { stage: StageProgress }) {
  switch (stage.status) {
    case "done":
      return <Check aria-hidden />;
    case "active":
      return <Loader aria-hidden className="spin" />;
    case "stalled":
    case "lost":
      return <X aria-hidden />;
    default:
      return <Circle aria-hidden />;
  }
}

export function ActivationHud() {
  const mode = usePresentation((s) => s.mode);
  const stages = usePresentation((s) => s.stages);
  const stage = usePresentation((s) => s.stage);
  const facility = usePresentation((s) => s.facility);
  const alarm = usePresentation((s) => s.alarm);
  const fusionW = usePresentation((s) => s.reading?.metrics.fusionPowerW ?? 0);
  const gain = usePresentation((s) => s.reading?.metrics.plasmaGainQ ?? 0);
  const cinematic = useCinematic();
  if (mode !== "simulate") return null;
  const shown = stages.filter((s) => s.status !== "skipped");
  const lost = shown.find((s) => s.status === "lost");
  const burning = shown.some((s) => s.id === "fusion" && s.status === "done") && fusionW > 0;
  const caption = lost
    ? { label: `${lost.label} lost`, detail: lost.detail, tone: "bad" }
    : stage !== null
      ? {
          label: stage.status === "stalled" ? `Stalled at ${stage.label}` : stage.label,
          detail: stage.detail,
          tone: stage.status === "stalled" ? "bad" : "active",
        }
      : burning
        ? {
            label: "Fusion",
            detail: `${fmtW(fusionW)} · Q ${Number.isFinite(gain) ? gain.toFixed(2) : "∞"}`,
            tone: "good",
          }
        : shown.length > 0 && shown.every((s) => s.status === "done")
          ? { label: "Plant running", detail: "All stages reached.", tone: "good" }
          : null;
  return (
    <div
      className={`activation${cinematic ? " activation--cinematic" : ""}`}
      data-alarm={alarm.toLowerCase()}
      role="status"
      aria-live="polite"
    >
      <div className="activation__row">
        <span className={`activation__facility activation__facility--${facility.toLowerCase()}`}>
          {FACILITY_LABEL[facility]}
        </span>
        {shown.length > 0 && (
          <ol className="activation__stages" aria-label="Activation stages">
            {shown.map((s) => (
              <li key={s.id} className={`activation__stage activation__stage--${s.status}`}>
                <StageIcon stage={s} />
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {caption !== null && (
        <p className={`activation__caption activation__caption--${caption.tone}`}>
          <strong>{caption.label}</strong> <span>{caption.detail}</span>
        </p>
      )}
      {cinematic && (
        <button type="button" className="activation__exit" onClick={() => setCinematic(false)}>
          Exit cinematic (Esc)
        </button>
      )}
    </div>
  );
}
