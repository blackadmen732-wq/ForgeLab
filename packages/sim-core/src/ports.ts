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

export interface PortCompatibility {
  readonly compatible: boolean;
  /** Why the two cannot be joined (when `compatible` is false). */
  readonly reason?: string;
  /** Joinable, but worth knowing: rating mismatches the simulation may punish. */
  readonly warnings: readonly string[];
}

const pct = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

/**
 * Whether two connection points may be joined, and what to watch out for.
 *
 * Hard incompatibilities are the ones no real installation would allow: different
 * networks, two outlets or two inlets facing each other, different working fluids,
 * different supply voltages. Rating differences (bore, pressure, current, flange size)
 * are warnings: real plants use reducers and adapters, and the simulation decides whether
 * the undersized side survives.
 */
export function checkPortCompatibility(a: ConnectionPoint, b: ConnectionPoint): PortCompatibility {
  if (!sameNetwork(a.connectionType, b.connectionType)) {
    return {
      compatible: false,
      reason: `${a.connectionType} and ${b.connectionType} interfaces belong to different systems.`,
      warnings: [],
    };
  }
  const pa = a.port;
  const pb = b.port;
  if (pa === undefined || pb === undefined) return { compatible: true, warnings: [] };
  if (pa.domain !== pb.domain) {
    return {
      compatible: false,
      reason: `A ${pa.domain} port cannot join a ${pb.domain} port.`,
      warnings: [],
    };
  }
  if (pa.direction !== "both" && pa.direction === pb.direction) {
    return {
      compatible: false,
      reason: `Both ends are ${pa.direction === "in" ? "inlets" : "outlets"} (${pa.label} and ${pb.label}).`,
      warnings: [],
    };
  }
  const warnings: string[] = [];
  switch (pa.domain) {
    case "electrical": {
      const other = pb as ElectricalPort;
      if (pct(pa.nominalVoltageV, other.nominalVoltageV) > 0.1) {
        return {
          compatible: false,
          reason: `Voltage mismatch: ${fmtV(pa.nominalVoltageV)} against ${fmtV(other.nominalVoltageV)}.`,
          warnings: [],
        };
      }
      if (pct(pa.ratedCurrentA, other.ratedCurrentA) > 0.25)
        warnings.push(
          `Current ratings differ (${fmtA(pa.ratedCurrentA)} vs ${fmtA(other.ratedCurrentA)}): the lower one limits the link.`,
        );
      break;
    }
    case "fluid": {
      const other = pb as FluidPort;
      if (pa.fluid !== other.fluid) {
        return {
          compatible: false,
          reason: `Different working fluids: ${pa.fluid} and ${other.fluid}.`,
          warnings: [],
        };
      }
      if (pct(pa.innerDiameterM, other.innerDiameterM) > 0.05)
        warnings.push(
          `Bores differ (${fmtMm(pa.innerDiameterM)} vs ${fmtMm(other.innerDiameterM)}): a reducer restricts flow to the smaller bore.`,
        );
      if (pct(pa.ratedPressurePa, other.ratedPressurePa) > 0.1)
        warnings.push(
          `Pressure ratings differ (${fmtMPa(pa.ratedPressurePa)} vs ${fmtMPa(other.ratedPressurePa)}).`,
        );
      break;
    }
    case "vacuum": {
      const other = pb as VacuumPort;
      if (pct(pa.flangeDiameterM, other.flangeDiameterM) > 0.05)
        warnings.push(
          `Flange sizes differ (DN${Math.round(pa.flangeDiameterM * 1000)} vs DN${Math.round(other.flangeDiameterM * 1000)}): the adapter limits conductance.`,
        );
      break;
    }
    case "shaft":
    case "heating": {
      const other = pb as ShaftPort | HeatingPort;
      if (pct(pa.ratedPowerW, other.ratedPowerW) > 0.25)
        warnings.push(
          `Power ratings differ (${fmtMW(pa.ratedPowerW)} vs ${fmtMW(other.ratedPowerW)}).`,
        );
      break;
    }
    default:
      break;
  }
  return { compatible: true, warnings };
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
  const base = { label, direction } as const;
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
      return d === null ? null : { ...base, domain: "vacuum", flangeDiameterM: d };
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
