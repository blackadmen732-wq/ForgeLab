import type { Meters, Newtons, Vec3 } from "@forgelab/shared";

export type ComponentId = string;
export type ConnectionId = string;
export type ConnectionPointId = string;

/**
 * Kinds of connection ForgeLab understands.
 *
 * `structural` and `mount` carry mechanical load. The rest are plant networks read by the
 * V0.1 plant solver (see docs/ARCHITECTURE.md §13):
 *   electrical — DC power network
 *   coolant    — primary coolant loop
 *   steam      — heat exchanger secondary side to a turbine
 *   shaft      — turbine to generator
 *   vacuum     — vacuum pump to vessel
 *   fuel       — fuel injector to vessel
 *   port       — plasma heater to vessel
 *   control    — sensor / controller / actuator signals
 */
export const CONNECTION_TYPES = Object.freeze([
  "structural",
  "mount",
  "electrical",
  "coolant",
  "vacuum",
  "fuel",
  "control",
  "shaft",
  "steam",
  "port",
] as const);

export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/** The connection types that transfer mechanical load in Phase 0. */
export const LOAD_BEARING_CONNECTION_TYPES: ReadonlySet<ConnectionType> = new Set<ConnectionType>([
  "structural",
  "mount",
]);

export function isLoadBearing(type: ConnectionType): boolean {
  return LOAD_BEARING_CONNECTION_TYPES.has(type);
}

/**
 * An attachment socket on a component.
 *
 * `localDirection` is the outward normal of the socket in the component's local frame.
 * It is not decoration: the structural solver uses it to decide which way load flows
 * across a connection, so a socket on the underside of a beam must point -Y.
 *
 * `maxLoadN` is the socket's own capacity. A link between two sockets is limited by the
 * weaker of the two; a socket without a stated capacity imposes no limit of its own.
 */
export interface ConnectionPoint {
  readonly id: ConnectionPointId;
  readonly localPosition: Vec3;
  readonly localDirection: Vec3;
  readonly connectionType: ConnectionType;
  readonly maxLoadN?: Newtons;
}

/** One end of an established link. */
export interface ConnectionEndpoint {
  readonly componentId: ComponentId;
  readonly connectionPointId: ConnectionPointId;
}

/**
 * An established link between two connection points on two different components.
 *
 * Connections are owned by the world. A component's `connections` array holds references
 * to these same frozen objects, so there is exactly one instance of every link and the
 * two ends can never disagree.
 */
export interface Connection {
  readonly id: ConnectionId;
  readonly type: ConnectionType;
  readonly from: ConnectionEndpoint;
  readonly to: ConnectionEndpoint;
  /**
   * Capacity of the link itself, in newtons. When omitted the capacity is the lower of
   * the two sockets' `maxLoadN`, and is unlimited if neither socket states one.
   */
  readonly maxLoadN?: Newtons;
}

/** A structural connection point placed at a local offset with an outward normal. */
export function connectionPoint(
  id: ConnectionPointId,
  localPosition: Vec3,
  localDirection: Vec3,
  connectionType: ConnectionType = "structural",
  maxLoadN?: Newtons,
): ConnectionPoint {
  if (maxLoadN === undefined) {
    return Object.freeze({ id, localPosition, localDirection, connectionType });
  }
  return Object.freeze({ id, localPosition, localDirection, connectionType, maxLoadN });
}

export function otherEndpoint(
  connection: Connection,
  componentId: ComponentId,
): ConnectionEndpoint {
  return connection.from.componentId === componentId ? connection.to : connection.from;
}

export function endpointFor(
  connection: Connection,
  componentId: ComponentId,
): ConnectionEndpoint | undefined {
  if (connection.from.componentId === componentId) return connection.from;
  if (connection.to.componentId === componentId) return connection.to;
  return undefined;
}

/** Distance tolerance used when deciding whether two sockets are close enough to link. */
export const CONNECTION_SNAP_TOLERANCE_M: Meters = 0.35;
