import type { ConnectionPoint, ConnectionType } from "./connections.js";

/**
 * Typed ports: the engineering interface of a finished component.
 *
 * A connection point says *where* two components meet and which network the link belongs
 * to (`connectionType`). Its optional `port` says what the interface is rated for, in the
 * terms an engineer would check before connecting two machines: voltage and current for
 * power, fluid, bore and pressure for pipework, flange size for vacuum, and so on.
 *
 * Magnetic fields, neutrons, gravity and thermal radiation are NOT ports. They act through
 * space and are computed from geometry by the solvers.
 */
export type PortDirection = "in" | "out" | "both";

interface PortBase {
  /** Short engineering label shown on the port, e.g. "POWER IN" or "COOLANT OUT". */
  readonly label: string;
  readonly direction: PortDirection;
  /**
   * True for a port that is blanked off when unused (a spare port on a vessel sector):
   * leaving it unconnected is a choice, not an oversight, so preflight does not flag it.
   */
  readonly optional?: boolean;
}

export interface StructuralPort extends PortBase {
  readonly domain: "structural";
}

export interface ElectricalPort extends PortBase {
  readonly domain: "electrical";
  readonly nominalVoltageV: number;
  readonly ratedCurrentA: number;
}

export type PortFluid = "pressurized-water" | "helium" | "cryogenic-helium" | "steam";

export interface FluidPort extends PortBase {
  readonly domain: "fluid";
  readonly fluid: PortFluid;
  /** Bore of the pipe connection. */
  readonly innerDiameterM: number;
  readonly ratedPressurePa: number;
  readonly ratedTemperatureK: number;
}

export interface VacuumPort extends PortBase {
  readonly domain: "vacuum";
  /** Nominal flange bore (ISO-K / CF "DN"). */
  readonly flangeDiameterM: number;
  /**
   * "chamber-end": the open end of a vessel segment. The flange spans the bore, so the
   * chamber is open to the hall there until it is joined to another segment, blanked off
   * or fitted with a pump.
   */
  readonly opening?: "chamber-end";
}

export interface FuelPort extends PortBase {
  readonly domain: "fuel";
  readonly medium: "D-T gas";
}

export interface ControlPort extends PortBase {
  readonly domain: "control";
  readonly signal: "measurement" | "command" | "interlock";
}

export interface ShaftPort extends PortBase {
  readonly domain: "shaft";
  readonly ratedPowerW: number;
}

/** A vessel access port for plasma heating (beam line, RF waveguide). */
export interface HeatingPort extends PortBase {
  readonly domain: "heating";
  readonly ratedPowerW: number;
}

export type PortSpec =
  | StructuralPort
  | ElectricalPort
  | FluidPort
  | VacuumPort
  | FuelPort
  | ControlPort
  | ShaftPort
  | HeatingPort;

export type PortDomain = PortSpec["domain"];

/** The network each port domain belongs to. */
export const PORT_DOMAIN_CONNECTION_TYPES: Readonly<Record<PortDomain, readonly ConnectionType[]>> =
  Object.freeze({
    structural: ["structural", "mount"],
    electrical: ["electrical"],
    fluid: ["coolant", "steam", "cryo"],
    vacuum: ["vacuum"],
    fuel: ["fuel"],
    control: ["control"],
    shaft: ["shaft"],
    heating: ["port"],
  });

/** Machine-readable reason codes (stable: the UI and tests key on them). */
export type CompatibilityCode =
  | "NETWORK_MISMATCH"
  | "DOMAIN_MISMATCH"
  | "SAME_DIRECTION"
  | "VOLTAGE_MISMATCH"
  | "CURRENT_RATING_MISMATCH"
  | "FLUID_MISMATCH"
  | "BORE_MISMATCH"
  | "PRESSURE_RATING_MISMATCH"
  | "TEMPERATURE_RATING_MISMATCH"
  | "FLANGE_MISMATCH"
  | "POWER_RATING_MISMATCH";

export interface CompatibilityReason {
  readonly code: CompatibilityCode;
  /** "error" makes the link impossible; "warning" allows it with a consequence. */
  readonly severity: "error" | "warning";
  /** The compared quantity on each side, in SI units, when there is one. */
  readonly source?: number | string;
  readonly target?: number | string;
  readonly message: string;
}

export type CompatibilityState = "compatible" | "warning" | "incompatible";

export interface PortCompatibility {
  readonly state: CompatibilityState;
  readonly reasons: readonly CompatibilityReason[];
  readonly compatible: boolean;
  /** Why the two cannot be joined (when `compatible` is false). */
  readonly reason?: string;
  /** Joinable, but worth knowing: rating mismatches the simulation may punish. */
  readonly warnings: readonly string[];
}

const pct = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

function result(reasons: readonly CompatibilityReason[]): PortCompatibility {
  const error = reasons.find((r) => r.severity === "error");
  if (error !== undefined)
    return {
      state: "incompatible",
      reasons: [error],
      compatible: false,
      reason: error.message,
      warnings: [],
    };
  return {
    state: reasons.length > 0 ? "warning" : "compatible",
    reasons,
    compatible: true,
    warnings: reasons.map((r) => r.message),
  };
}

/**
 * Whether two connection points may be joined, and what to watch out for. This is the one
 * authority on compatibility: the editor only displays the result.
 *
 * Hard incompatibilities (errors) are the ones no real installation allows: different
 * networks, two outlets or two inlets facing each other, different working fluids,
 * different supply voltages (there is no transformer in a link). Rating differences —
 * bore, pressure, temperature, current, flange size, power — are warnings: real plants
 * use reducers and adapters, and the simulation decides whether the weaker side survives.
 * Rules and thresholds:
 *  - voltage: more than 10 % apart → error;  current: more than 25 % apart → warning
 *  - bore and flange: more than 5 % apart → warning; pressure: more than 10 % → warning
 *  - temperature rating: more than 10 % apart → warning; shaft/heating power: 25 % → warning
 */
export function checkPortCompatibility(a: ConnectionPoint, b: ConnectionPoint): PortCompatibility {
  if (!sameNetwork(a.connectionType, b.connectionType))
    return result([
      {
        code: "NETWORK_MISMATCH",
        severity: "error",
        source: a.connectionType,
        target: b.connectionType,
        message: `${a.connectionType} and ${b.connectionType} interfaces belong to different systems.`,
      },
    ]);
  const pa = a.port;
  const pb = b.port;
  if (pa === undefined || pb === undefined) return result([]);
  if (pa.domain !== pb.domain)
    return result([
      {
        code: "DOMAIN_MISMATCH",
        severity: "error",
        source: pa.domain,
        target: pb.domain,
        message: `A ${pa.domain} port cannot join a ${pb.domain} port.`,
      },
    ]);
  if (pa.direction !== "both" && pa.direction === pb.direction)
    return result([
      {
        code: "SAME_DIRECTION",
        severity: "error",
        source: pa.direction,
        target: pb.direction,
        message: `Both ends are ${pa.direction === "in" ? "inlets" : "outlets"} (${pa.label} and ${pb.label}).`,
      },
    ]);
  const reasons: CompatibilityReason[] = [];
  const warn = (
    code: CompatibilityCode,
    source: number | string,
    target: number | string,
    message: string,
  ) => reasons.push({ code, severity: "warning", source, target, message });
  switch (pa.domain) {
    case "electrical": {
      const other = pb as ElectricalPort;
      if (pct(pa.nominalVoltageV, other.nominalVoltageV) > 0.1)
        return result([
          {
            code: "VOLTAGE_MISMATCH",
            severity: "error",
            source: pa.nominalVoltageV,
            target: other.nominalVoltageV,
            message: `Voltage mismatch: ${fmtV(pa.nominalVoltageV)} against ${fmtV(other.nominalVoltageV)}. A transformer or converter is needed.`,
          },
        ]);
      if (pct(pa.ratedCurrentA, other.ratedCurrentA) > 0.25)
        warn(
          "CURRENT_RATING_MISMATCH",
          pa.ratedCurrentA,
          other.ratedCurrentA,
          `Current ratings differ (${fmtA(pa.ratedCurrentA)} vs ${fmtA(other.ratedCurrentA)}): the lower one limits the link.`,
        );
      break;
    }
    case "fluid": {
      const other = pb as FluidPort;
      if (pa.fluid !== other.fluid)
        return result([
          {
            code: "FLUID_MISMATCH",
            severity: "error",
            source: pa.fluid,
            target: other.fluid,
            message: `Different working fluids: ${pa.fluid} and ${other.fluid}.`,
          },
        ]);
      if (pct(pa.innerDiameterM, other.innerDiameterM) > 0.05)
        warn(
          "BORE_MISMATCH",
          pa.innerDiameterM,
          other.innerDiameterM,
          `Bores differ (${fmtMm(pa.innerDiameterM)} vs ${fmtMm(other.innerDiameterM)}): a reducer restricts flow to the smaller bore.`,
        );
      if (pct(pa.ratedPressurePa, other.ratedPressurePa) > 0.1)
        warn(
          "PRESSURE_RATING_MISMATCH",
          pa.ratedPressurePa,
          other.ratedPressurePa,
          `Pressure ratings differ (${fmtMPa(pa.ratedPressurePa)} vs ${fmtMPa(other.ratedPressurePa)}): the lower one limits the loop.`,
        );
      if (pct(pa.ratedTemperatureK, other.ratedTemperatureK) > 0.1)
        warn(
          "TEMPERATURE_RATING_MISMATCH",
          pa.ratedTemperatureK,
          other.ratedTemperatureK,
          `Temperature ratings differ (${pa.ratedTemperatureK.toFixed(0)} K vs ${other.ratedTemperatureK.toFixed(0)} K): the lower one limits the loop.`,
        );
      break;
    }
    case "vacuum": {
      const other = pb as VacuumPort;
      if (pct(pa.flangeDiameterM, other.flangeDiameterM) > 0.05)
        warn(
          "FLANGE_MISMATCH",
          pa.flangeDiameterM,
          other.flangeDiameterM,
          `Flange sizes differ (DN${Math.round(pa.flangeDiameterM * 1000)} vs DN${Math.round(other.flangeDiameterM * 1000)}): the adapter limits conductance.`,
        );
      break;
    }
    case "shaft":
    case "heating": {
      const other = pb as ShaftPort | HeatingPort;
      if (pct(pa.ratedPowerW, other.ratedPowerW) > 0.25)
        warn(
          "POWER_RATING_MISMATCH",
          pa.ratedPowerW,
          other.ratedPowerW,
          `Power ratings differ (${fmtMW(pa.ratedPowerW)} vs ${fmtMW(other.ratedPowerW)}).`,
        );
      break;
    }
    default:
      break;
  }
  return result(reasons);
}

function sameNetwork(a: ConnectionType, b: ConnectionType): boolean {
  if (a === b) return true;
  const structural = (t: ConnectionType) => t === "structural" || t === "mount";
  return structural(a) && structural(b);
}

const fmtV = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kV` : `${v.toFixed(0)} V`);
const fmtA = (a: number) => (a >= 1000 ? `${(a / 1000).toFixed(1)} kA` : `${a.toFixed(0)} A`);
const fmtMm = (m: number) => `${(m * 1000).toFixed(0)} mm`;
const fmtMPa = (p: number) => `${(p / 1e6).toFixed(1)} MPa`;
const fmtMW = (w: number) => `${(w / 1e6).toFixed(1)} MW`;

/** Validates an untrusted port spec (from a save file). Returns null when malformed. */
export function parsePortSpec(value: unknown): PortSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const label = typeof r["label"] === "string" ? r["label"].slice(0, 40) : null;
  const direction = r["direction"];
  if (label === null || (direction !== "in" && direction !== "out" && direction !== "both"))
    return null;
  const positive = (key: string) =>
    typeof r[key] === "number" && Number.isFinite(r[key]) && (r[key] as number) > 0
      ? (r[key] as number)
      : null;
  const base =
    r["optional"] === true
      ? ({ label, direction, optional: true } as const)
      : ({ label, direction } as const);
  switch (r["domain"]) {
    case "structural":
      return { ...base, domain: "structural" };
    case "electrical": {
      const v = positive("nominalVoltageV");
      const i = positive("ratedCurrentA");
      return v === null || i === null
        ? null
        : { ...base, domain: "electrical", nominalVoltageV: v, ratedCurrentA: i };
    }
    case "fluid": {
      const fluid = r["fluid"];
      const d = positive("innerDiameterM");
      const p = positive("ratedPressurePa");
      const t = positive("ratedTemperatureK");
      if (
        (fluid !== "pressurized-water" &&
          fluid !== "helium" &&
          fluid !== "cryogenic-helium" &&
          fluid !== "steam") ||
        d === null ||
        p === null ||
        t === null
      )
        return null;
      return {
        ...base,
        domain: "fluid",
        fluid,
        innerDiameterM: d,
        ratedPressurePa: p,
        ratedTemperatureK: t,
      };
    }
    case "vacuum": {
      const d = positive("flangeDiameterM");
      if (d === null) return null;
      if (r["opening"] === undefined) return { ...base, domain: "vacuum", flangeDiameterM: d };
      return r["opening"] === "chamber-end"
        ? { ...base, domain: "vacuum", flangeDiameterM: d, opening: "chamber-end" }
        : null;
    }
    case "fuel":
      return r["medium"] === "D-T gas" ? { ...base, domain: "fuel", medium: "D-T gas" } : null;
    case "control": {
      const signal = r["signal"];
      return signal === "measurement" || signal === "command" || signal === "interlock"
        ? { ...base, domain: "control", signal }
        : null;
    }
    case "shaft":
    case "heating": {
      const w = positive("ratedPowerW");
      return w === null ? null : { ...base, domain: r["domain"], ratedPowerW: w };
    }
    default:
      return null;
  }
}
