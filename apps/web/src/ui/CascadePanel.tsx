import { useMemo } from "react";
import { type CascadeEvent, type CascadeSnapshot, labelOf } from "@forgelab/sim-core";
import { EVENT_DEPTH_COLORS } from "../scene/theme.js";
import { useStore, useUiState } from "../state/useStore.js";

const DEPTH_NAMES = ["Root", "Secondary", "Tertiary"];

function depthName(depth: number): string {
  return DEPTH_NAMES[depth] ?? `Order ${depth + 1}`;
}

function formatEnergy(joules: number): string {
  if (joules >= 1e9) return `${(joules / 1e9).toFixed(2)} GJ`;
  if (joules >= 1e6) return `${(joules / 1e6).toFixed(1)} MJ`;
  if (joules >= 1e3) return `${(joules / 1e3).toFixed(0)} kJ`;
  return "";
}

/**
 * The catastrophe graph.
 *
 * Every row is an event the cascade solver recorded, with the events that physically
 * caused it. Clicking one replays the run to that instant: the simulation is deterministic,
 * so "replay" means re-simulating, not playing back a recording. The diagnosis keeps the
 * root cause and the most dramatic event apart, because they are rarely the same thing.
 */
export function CascadePanel() {
  const store = useStore();
  const ui = useUiState();
  const cascade = ui.cascade;

  if (cascade === undefined) {
    return (
      <p className="panel__hint">
        This assembly declares no plant physics, so there is no cascade to follow. Load one of the
        cascade scenes from the Scenes list to see a single fault propagate — or stop — through
        heat, gas, flame, arcs, coolant, magnets and plasma.
      </p>
    );
  }

  const diagnosis = cascade.diagnosis;
  const chain = new Set(diagnosis.chainEventIds);

  return (
    <div className="cascade">
      <div className="cascade__summary">
        <p className="cascade__diagnosis">{diagnosis.summary}</p>
        <div className="button-row">
          <button
            type="button"
            className="button button--primary"
            onClick={() => store.watchCascade()}
          >
            ▶ Watch cascade
          </button>
          {diagnosis.rootCauseEventIds[0] !== undefined && (
            <button
              type="button"
              className="button"
              onClick={() => store.jumpToEvent(diagnosis.rootCauseEventIds[0]!)}
            >
              Root event
            </button>
          )}
          {diagnosis.mostDramaticEventId !== undefined && (
            <button
              type="button"
              className="button"
              onClick={() => store.jumpToEvent(diagnosis.mostDramaticEventId!)}
            >
              Most dramatic
            </button>
          )}
        </div>
        {ui.replay !== null && (
          <div className="bar" title="Re-simulating deterministically to the selected event">
            <div
              className="bar__fill"
              style={{
                width: `${Math.round(ui.replay.progress * 100)}%`,
                background: "var(--accent)",
              }}
            />
          </div>
        )}
      </div>

      <Timeline cascade={cascade} selectedId={ui.selectedEventId} timeSec={ui.simulatedTimeSec} />

      <ol className="cascade__events">
        {cascade.events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            inChain={chain.has(event.id)}
            selected={event.id === ui.selectedEventId}
            onJump={(id) => store.jumpToEvent(id)}
          />
        ))}
      </ol>

      <details className="cascade__confidence">
        <summary>Model confidence — reduced models, not certification software</summary>
        <ul>
          {cascade.modelConfidence.map((entry) => (
            <li key={entry.model}>
              <span className={`confidence confidence--${entry.confidence}`}>
                {entry.confidence}
              </span>{" "}
              <strong>{entry.model}.</strong> {entry.note}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function EventRow({
  event,
  inChain,
  selected,
  onJump,
}: {
  readonly event: CascadeEvent;
  readonly inChain: boolean;
  readonly selected: boolean;
  readonly onJump: (id: string) => void;
}) {
  const color = EVENT_DEPTH_COLORS[Math.min(event.depth, EVENT_DEPTH_COLORS.length - 1)];
  const energy = formatEnergy(event.energyReleasedJ);
  return (
    <li
      className={`cascade__event${selected ? " cascade__event--selected" : ""}${inChain ? " cascade__event--chain" : ""}`}
    >
      <button
        type="button"
        className="cascade__jump"
        onClick={() => onJump(event.id)}
        title="Replay to this event"
      >
        <span className="cascade__depth" style={{ borderColor: color, color }}>
          {depthName(event.depth)}
        </span>
        <span className="cascade__id">{event.id}</span>
        <span className="cascade__time">t = {event.timeSec.toFixed(1)} s</span>
        <span className="cascade__kind">{labelOf(event.kind)}</span>
        <span className="cascade__component">@ {event.componentId}</span>
        {energy !== "" && <span className="cascade__energy">{energy}</span>}
      </button>
      <p className="cascade__description">{event.description}</p>
      {event.parentIds.length > 0 && (
        <p className="cascade__parents">
          caused by{" "}
          {event.parentIds.map((parent, i) => (
            <span key={parent}>
              {i > 0 && ", "}
              <button type="button" className="link" onClick={() => onJump(parent)}>
                {parent}
              </button>
            </span>
          ))}
        </p>
      )}
    </li>
  );
}

/** Events on a time axis, coloured by causal depth. Click a marker to jump to it. */
function Timeline({
  cascade,
  selectedId,
  timeSec,
}: {
  readonly cascade: CascadeSnapshot;
  readonly selectedId: string | null;
  readonly timeSec: number;
}) {
  const store = useStore();
  const span = useMemo(
    () => Math.max(timeSec, ...cascade.events.map((e) => e.timeSec), 1),
    [cascade.events, timeSec],
  );
  return (
    <div className="timeline" aria-label="Cascade timeline">
      <div className="timeline__now" style={{ left: `${(timeSec / span) * 100}%` }} />
      {cascade.events.map((event) => (
        <button
          key={event.id}
          type="button"
          className={`timeline__marker${event.id === selectedId ? " timeline__marker--selected" : ""}`}
          style={{
            left: `${(event.timeSec / span) * 100}%`,
            background: EVENT_DEPTH_COLORS[Math.min(event.depth, EVENT_DEPTH_COLORS.length - 1)],
          }}
          title={`${event.id} · t = ${event.timeSec.toFixed(1)} s · ${labelOf(event.kind)} @ ${event.componentId}`}
          onClick={() => store.jumpToEvent(event.id)}
        />
      ))}
    </div>
  );
}
