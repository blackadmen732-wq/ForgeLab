import { useUiState } from "../state/useStore.js";
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
  const ui = useUiState();

  return (
    <section className="panel panel--bottom">
      <div className="panel__row">
        <h2 className="panel__title panel__title--inline">
          Failures{ui.failures.length > 0 ? ` (${ui.failures.length})` : ""}
        </h2>
        <span className="status">{ui.status}</span>
      </div>

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
    </section>
  );
}
