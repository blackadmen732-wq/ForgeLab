import type { Seconds } from "@forgelab/shared";
import type { ComponentId } from "../connections.js";
import type { CascadeDiagnosis, CascadeEvent, CascadeEventKind, HazardFamily } from "./types.js";

/**
 * Share of a component's attributed energy an event must have delivered to count as a
 * parent of that component's next threshold crossing. Attribution bookkeeping, not
 * physics: it decides which arrows the graph draws, never whether anything fails.
 */
const PARENT_SHARE_THRESHOLD = 0.2;
const MAX_PARENTS = 3;

/**
 * Records energy delivered to one component, by the event that caused it.
 *
 * When a component crosses a threshold, its parents are the events that delivered a real
 * share of what it absorbed. Proximity alone never appears here: an event is only in the
 * ledger if one of its hazards actually delivered energy.
 */
export class AttributionLedger {
  readonly #byEvent = new Map<string, number>();

  add(eventId: string | undefined, energyJ: number): void {
    if (eventId === undefined || !(energyJ > 0)) return;
    this.#byEvent.set(eventId, (this.#byEvent.get(eventId) ?? 0) + energyJ);
  }

  /** Dominant contributors, strongest first, ties broken by id. */
  parents(): string[] {
    let total = 0;
    for (const value of this.#byEvent.values()) total += value;
    if (total <= 0) return [];
    return [...this.#byEvent.entries()]
      .filter(([, value]) => value / total >= PARENT_SHARE_THRESHOLD)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_PARENTS)
      .map(([id]) => id);
  }

  /** The single strongest contributor. */
  dominant(): string | undefined {
    return this.parents()[0];
  }

  clear(): void {
    this.#byEvent.clear();
  }
}

interface MutableEvent {
  id: string;
  tick: number;
  timeSec: Seconds;
  kind: CascadeEventKind;
  family: HazardFamily;
  componentId: ComponentId;
  description: string;
  parentIds: readonly string[];
  depth: number;
  energyReleasedJ: number;
}

/** The causal graph of a run. Append-only; events are never edited except for energy. */
export class CatastropheGraph {
  readonly #events: MutableEvent[] = [];
  readonly #byId = new Map<string, MutableEvent>();
  #frozen: readonly CascadeEvent[] | undefined;

  record(params: {
    tick: number;
    timeSec: Seconds;
    kind: CascadeEventKind;
    family: HazardFamily;
    componentId: ComponentId;
    description: string;
    parentIds: readonly string[];
  }): string {
    const id = `EVT-${String(this.#events.length + 1).padStart(3, "0")}`;
    const parentIds = [...new Set(params.parentIds)].filter((p) => this.#byId.has(p));
    const depth =
      parentIds.length === 0 ? 0 : Math.min(...parentIds.map((p) => this.#byId.get(p)!.depth)) + 1;
    const event: MutableEvent = {
      ...params,
      id,
      parentIds: Object.freeze(parentIds),
      depth,
      energyReleasedJ: 0,
    };
    this.#events.push(event);
    this.#byId.set(id, event);
    this.#frozen = undefined;
    return id;
  }

  /** Credits energy released by an ongoing process (a fire, an arc) to the event that began it. */
  addEnergy(eventId: string | undefined, energyJ: number): void {
    if (eventId === undefined || !(energyJ > 0)) return;
    const event = this.#byId.get(eventId);
    if (event === undefined) return;
    event.energyReleasedJ += energyJ;
    this.#frozen = undefined;
  }

  get(eventId: string): CascadeEvent | undefined {
    return this.list().find((event) => event.id === eventId);
  }

  get size(): number {
    return this.#events.length;
  }

  list(): readonly CascadeEvent[] {
    if (this.#frozen === undefined) {
      this.#frozen = Object.freeze(this.#events.map((event) => Object.freeze({ ...event })));
    }
    return this.#frozen;
  }

  /** Every ancestor of an event, nearest first. */
  ancestors(eventId: string): string[] {
    const seen = new Set<string>();
    const queue = [...(this.#byId.get(eventId)?.parentIds ?? [])];
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      queue.push(...(this.#byId.get(id)?.parentIds ?? []));
    }
    return order;
  }

  /**
   * Separates the root cause from the most dramatic event.
   *
   * The most dramatic event is whatever released the most energy. Its root cause is found
   * by walking parents back to an event with none. The two are usually different — a
   * battery fire may be the largest thing that happened, while the root cause was an
   * overheated joint several links earlier — and the diagnosis says so.
   */
  diagnose(describeComponent: (id: ComponentId) => string): CascadeDiagnosis {
    const events = this.#events;
    if (events.length === 0) {
      return Object.freeze({
        rootCauseEventIds: Object.freeze([]),
        mostDramaticEventId: undefined,
        chainEventIds: Object.freeze([]),
        summary: "No cascade events. Nothing in the plant has crossed a physical limit.",
      });
    }

    let dramatic = events[0]!;
    for (const event of events) {
      if (event.energyReleasedJ > dramatic.energyReleasedJ) dramatic = event;
    }
    if (dramatic.energyReleasedJ === 0) dramatic = events[events.length - 1]!;

    // Walk back along the parent that is itself deepest-rooted (earliest first parent).
    const chain: MutableEvent[] = [dramatic];
    let cursor = dramatic;
    while (cursor.parentIds.length > 0) {
      const next = this.#byId.get(cursor.parentIds[0]!)!;
      chain.unshift(next);
      cursor = next;
    }

    const roots = [
      ...new Set(
        [dramatic.id, ...this.ancestors(dramatic.id)].filter(
          (id) => this.#byId.get(id)!.parentIds.length === 0,
        ),
      ),
    ].sort();

    const root = chain[0]!;
    const chainText = chain.map((event) => labelOf(event.kind)).join(" -> ");
    const summary =
      root.id === dramatic.id
        ? `The largest event, ${labelOf(dramatic.kind)} at ${describeComponent(dramatic.componentId)}, ` +
          `had no physical cause upstream of it: it is its own root cause. ${root.description}`
        : `Most dramatic event: ${labelOf(dramatic.kind)} at ${describeComponent(dramatic.componentId)} ` +
          `(${formatEnergy(dramatic.energyReleasedJ)} released). ` +
          `Root cause: ${labelOf(root.kind)} at ${describeComponent(root.componentId)} — ${root.description} ` +
          `Chain: ${chainText}.`;

    return Object.freeze({
      rootCauseEventIds: Object.freeze(roots),
      mostDramaticEventId: dramatic.id,
      chainEventIds: Object.freeze(chain.map((event) => event.id)),
      summary,
    });
  }
}

/** Plain-language label for an event kind. */
export function labelOf(kind: CascadeEventKind): string {
  return kind.replace(/-/g, " ");
}

function formatEnergy(joules: number): string {
  if (joules >= 1e9) return `${(joules / 1e9).toFixed(2)} GJ`;
  if (joules >= 1e6) return `${(joules / 1e6).toFixed(2)} MJ`;
  if (joules >= 1e3) return `${(joules / 1e3).toFixed(1)} kJ`;
  return `${joules.toFixed(0)} J`;
}
