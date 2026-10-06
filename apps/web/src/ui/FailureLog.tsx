import { useStore, useUiState } from "../state/useStore.js";
import { CascadePanel } from "./CascadePanel.js";
import { STATUS_COLORS } from "../scene/theme.js";
import { formatRatio, formatSeconds } from "./format.js";

/**
 * The failure log.
 *
 * ForgeLab never reports a bare "FAILED". Each entry carries what was measured, the limit
 * it crossed, and the sentence the solver wrote to explain how the load got there. The
 * text is produced by `sim-core`; this panel only lays it out.
 */
export function FailureLog() {
  const store = useStore();
  const ui = useUiState();
  const eventCount = ui.cascade?.events.length ?? 0;

  return (
    <section className={`panel panel--bottom${ui.bottomTab === "cascade" ? " panel--tall" : ""}`}>
      <div className="panel__row">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={ui.bottomTab === "failures"}
            className={`tab${ui.bottomTab === "failures" ? " tab--active" : ""}`}
            onClick={() => store.setBottomTab("failures")}
          >
            Failures{ui.failures.length > 0 ? ` (${ui.failures.length})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ui.bottomTab === "cascade"}
            className={`tab${ui.bottomTab === "cascade" ? " tab--active" : ""}`}
            onClick={() => store.setBottomTab("cascade")}
          >
            Cascade{eventCount > 0 ? ` (${eventCount})` : ""}
          </button>
        </div>
        <span className="status">{ui.status}</span>
      </div>

      {ui.bottomTab === "cascade" ? <CascadePanel /> : <FailureList />}
    </section>
  );
}

function FailureList() {
  const ui = useUiState();
  return (
    <>
      {ui.diagnostics.map((diagnostic) => (
        <p key={diagnostic} className="diagnostic">
          {diagnostic}
        </p>
      ))}

      {ui.failures.length === 0 ? (
        <p className="panel__hint">
          No failures. Every member is within its allowable stress and every rated joint is within
          capacity.
        </p>
      ) : (
        <ul className="failures">
          {ui.failures.map((failure) => (
            <li key={`${failure.componentId}-${failure.failureType}-${failure.connectionId ?? ""}`}>
              <div className="failures__head">
                <span className="failures__type" style={{ color: STATUS_COLORS.failed }}>
                  {failure.failureType.replace(/_/g, " ")}
                </span>
                <span className="failures__meta">
                  {failure.system} · {failure.componentId} · t ={" "}
                  {formatSeconds(failure.timestampSec)} · {formatRatio(failure.utilization)}× limit
                </span>
              </div>
              <p className="failures__cause">{failure.cause}</p>
              {failure.loadPathComponentIds.length > 0 && (
                <p className="failures__path">
                  Load path: {failure.loadPathComponentIds.join(" ← ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
