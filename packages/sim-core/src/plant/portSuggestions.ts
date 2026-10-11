import type { SimulationComponent } from "../component.js";
import type { Connection, ConnectionEndpoint } from "../connections.js";
import { Vec3Math } from "@forgelab/shared";
import {
  checkPortCompatibility,
  type CompatibilityState,
  type PortCompatibility,
  type PortDomain,
} from "../ports.js";
import { socketWorldPoint } from "./topology.js";

/**
 * Open ports and connection suggestions: what is left to connect in a design, and which
 * ports elsewhere could take each one. A convenience for building quickly; the verdict on
 * every pair is `checkPortCompatibility`, the same authority the connect tool uses, so the
 * editor never decides compatibility itself (CLAUDE.md §7).
 *
 * Suggestions rank joinable ports only (compatible first, then warnings), nearest first.
 * They never prescribe: the player picks one, or none.
 */
export interface OpenPort {
  readonly endpoint: ConnectionEndpoint;
  readonly componentLabel: string;
  readonly label: string;
  readonly domain: PortDomain;
  /** A spare that may be left blanked off (preflight does not report it). */
  readonly optional: boolean;
}

export interface PortSuggestion {
  readonly port: OpenPort;
  readonly state: Exclude<CompatibilityState, "incompatible">;
  readonly compatibility: PortCompatibility;
  /** Straight-line distance between the two ports, m. */
  readonly distanceM: number;
}

/** Domains listed as open ports. Structural sockets are where parts sit, not services. */
const LISTED_DOMAINS: ReadonlySet<PortDomain> = new Set([
  "electrical",
  "fluid",
  "vacuum",
  "fuel",
  "control",
  "shaft",
  "heating",
]);

const key = (e: ConnectionEndpoint) => `${e.componentId}/${e.connectionPointId}`;
const labelOf = (c: SimulationComponent) => (c.label.trim() !== "" ? c.label : c.id);

/** Every typed, non-structural port no connection uses, in component then port order. */
export function openPorts(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
): OpenPort[] {
  const used = new Set<string>();
  for (const c of connections) {
    used.add(key(c.from));
    used.add(key(c.to));
  }
  const out: OpenPort[] = [];
  for (const component of components) {
    for (const point of component.connectionPoints) {
      const port = point.port;
      if (port === undefined || !LISTED_DOMAINS.has(port.domain)) continue;
      const endpoint = { componentId: component.id, connectionPointId: point.id };
      if (used.has(key(endpoint))) continue;
      out.push({
        endpoint,
        componentLabel: labelOf(component),
        label: port.label,
        domain: port.domain,
        optional: port.optional === true,
      });
    }
  }
  return out;
}

/**
 * Open ports on other components that `from` could be joined to, best first: compatible
 * before warning, then nearest, then by id (deterministic). Incompatible ports are left out.
 */
export function suggestConnections(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
  from: ConnectionEndpoint,
  limit = 5,
): PortSuggestion[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const source = byId.get(from.componentId);
  const sourcePoint = source?.connectionPoints.find((p) => p.id === from.connectionPointId);
  if (source === undefined || sourcePoint === undefined) return [];
  const origin = socketWorldPoint(source, sourcePoint.id)!;
  const out: PortSuggestion[] = [];
  for (const open of openPorts(components, connections)) {
    if (open.endpoint.componentId === from.componentId) continue;
    const target = byId.get(open.endpoint.componentId)!;
    const point = target.connectionPoints.find((p) => p.id === open.endpoint.connectionPointId)!;
    const compatibility = checkPortCompatibility(sourcePoint, point);
    if (compatibility.state === "incompatible") continue;
    out.push({
      port: open,
      state: compatibility.state,
      compatibility,
      distanceM: Vec3Math.distance(origin, socketWorldPoint(target, point.id)!),
    });
  }
  out.sort(
    (a, b) =>
      (a.state === b.state ? 0 : a.state === "compatible" ? -1 : 1) ||
      a.distanceM - b.distanceM ||
      key(a.port.endpoint).localeCompare(key(b.port.endpoint)),
  );
  return out.slice(0, Math.max(0, limit));
}

export interface ConnectionWarning {
  readonly connectionId: string;
  readonly from: ConnectionEndpoint;
  readonly to: ConnectionEndpoint;
  readonly compatibility: PortCompatibility;
}

/** Existing connections whose ports are joinable only with a warning (or no longer joinable). */
export function connectionWarnings(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
): ConnectionWarning[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const point = (e: ConnectionEndpoint) =>
    byId.get(e.componentId)?.connectionPoints.find((p) => p.id === e.connectionPointId);
  const out: ConnectionWarning[] = [];
  for (const c of connections) {
    const a = point(c.from);
    const b = point(c.to);
    if (a === undefined || b === undefined) continue;
    const compatibility = checkPortCompatibility(a, b);
    if (compatibility.state !== "compatible")
      out.push({ connectionId: c.id, from: c.from, to: c.to, compatibility });
  }
  return out;
}
