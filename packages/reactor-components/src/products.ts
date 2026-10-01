import type { PortSpec } from "@forgelab/sim-core";
import type { ProductInfo, ProductRating } from "./definition.js";

/**
 * Product sheets and typed ports for the V0.1 catalogue.
 *
 * These parts keep their V0.1 physics exactly: their internals are descriptive (they do
 * not change mass), so existing designs, the verification scenario and every result stay
 * the same. The finished-component set in `finished.ts` goes further: there the internals
 * define mass and the ports carry ratings the solvers use.
 *
 * Electrical ports use ForgeLab's 20 kV DC plant bus (the voltage the grid connection and
 * generator regulate); rated currents are the part's nominal power at that voltage.
 */
type Params = Readonly<Record<string, number | boolean | string>>;

export const PLANT_BUS_V = 20_000;

const n = (p: Params, k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
const mw = (w: number) => `${(w / 1e6).toFixed(w >= 1e8 ? 0 : 1)} MW`;
const kw = (w: number) => (w >= 1e6 ? mw(w) : `${(w / 1e3).toFixed(0)} kW`);
const rating = (label: string, value: string): ProductRating => ({ label, value });

/* ---------------- ports ---------------- */

export const power = (
  direction: "in" | "out" | "both",
  ratedCurrentA: number,
  label = direction === "out" ? "POWER OUT" : direction === "in" ? "POWER IN" : "POWER",
): PortSpec => ({
  domain: "electrical",
  label,
  direction,
  nominalVoltageV: PLANT_BUS_V,
  ratedCurrentA,
});

/** Pressurised-water coolant port (PWR primary rating: 15.5 MPa, 620 K). */
export const water = (
  direction: "in" | "out" | "both",
  boreM: number,
  label?: string,
): PortSpec => ({
  domain: "fluid",
  label:
    label ?? (direction === "in" ? "COOLANT IN" : direction === "out" ? "COOLANT OUT" : "COOLANT"),
  direction,
  fluid: "pressurized-water",
  innerDiameterM: boreM,
  ratedPressurePa: 15.5e6,
  ratedTemperatureK: 620,
});

export const vacuum = (direction: "in" | "out" | "both", flangeM: number): PortSpec => ({
  domain: "vacuum",
  label: direction === "in" ? "PUMPING PORT" : "VACUUM",
  direction,
  flangeDiameterM: flangeM,
});

export const fuel = (direction: "in" | "out"): PortSpec => ({
  domain: "fuel",
  label: direction === "in" ? "FUEL IN" : "FUEL OUT",
  direction,
  medium: "D-T gas",
});

export const control = (
  signal: "measurement" | "command" | "interlock",
  label = "CONTROL",
): PortSpec => ({
  domain: "control",
  label,
  direction: "both",
  signal,
});

export const shaft = (direction: "in" | "out", ratedPowerW: number): PortSpec => ({
  domain: "shaft",
  label: direction === "in" ? "SHAFT IN" : "SHAFT OUT",
  direction,
  ratedPowerW,
});

export const heating = (direction: "in" | "out", ratedPowerW: number): PortSpec => ({
  domain: "heating",
  label: direction === "in" ? "HEATING PORT" : "BEAM OUT",
  direction,
  ratedPowerW,
});

/** Port specs per type and socket id; a function receives the part's dimensions. */
export type PortSource = PortSpec | ((d: Readonly<Record<string, number>>) => PortSpec);

const pipeBore = (d: Readonly<Record<string, number>>) =>
  2 * ((d["outerRadiusM"] ?? 0.39) - Math.min(d["wallM"] ?? 0.06, (d["outerRadiusM"] ?? 0.39) / 3));

export const V01_PORTS: Readonly<Record<string, Readonly<Record<string, PortSource>>>> = {
  "reactor-chamber": {
    vacuum: vacuum("in", 0.25),
    fuel: fuel("in"),
    heating: heating("in", 50e6),
    "coolant-in": water("in", 0.3),
    "coolant-out": water("out", 0.3),
    sensor: control("measurement", "DIAGNOSTICS"),
  },
  "tokamak-vessel": {
    vacuum: vacuum("in", 0.8),
    fuel: fuel("in"),
    heating: heating("in", 50e6),
    "coolant-in": water("in", 0.8),
    "coolant-out": water("out", 0.8),
    sensor: control("measurement", "DIAGNOSTICS"),
  },
  "tf-coil-set": {
    power: power("in", 400, "CRYOPLANT POWER"),
    "coolant-in": water("in", 0.3, "CASE COOLING IN"),
    "coolant-out": water("out", 0.3, "CASE COOLING OUT"),
    sensor: control("measurement", "QUENCH DETECTION"),
  },
  "solenoid-coil": {
    power: power("in", 500),
    "coolant-in": water("in", 0.1),
    "coolant-out": water("out", 0.1),
    sensor: control("measurement"),
  },
  "fuel-injector": { fuel: fuel("out"), power: power("in", 50), control: control("command") },
  "neutral-beam": {
    port: heating("out", 50e6),
    power: power("in", 7200),
    control: control("command"),
  },
  "vacuum-pump": {
    vacuum: vacuum("out", 0.8),
    power: power("in", 50),
    control: control("command"),
  },
  "grid-connection": { power: power("out", 50_000, "GRID SUPPLY") },
  "bus-bar": { a: power("both", 8000, "BUS"), b: power("both", 8000, "BUS") },
  breaker: {
    line: power("both", 8000, "LINE"),
    load: power("both", 8000, "LOAD"),
    control: control("interlock", "TRIP"),
  },
  "breeding-blanket": {
    "coolant-in": water("in", 1),
    "coolant-out": water("out", 1),
    sensor: control("measurement"),
  },
  "coolant-pipe": {
    a: (d) => water("both", pipeBore(d), "END A"),
    b: (d) => water("both", pipeBore(d), "END B"),
  },
  "coolant-pump": {
    inlet: water("in", 0.66, "SUCTION"),
    outlet: water("out", 0.66, "DISCHARGE"),
    power: power("in", 300),
    control: control("command"),
  },
  "steam-generator": {
    "primary-in": water("in", 0.8, "PRIMARY IN"),
    "primary-out": water("out", 0.8, "PRIMARY OUT"),
    steam: {
      domain: "fluid",
      label: "STEAM OUT",
      direction: "out",
      fluid: "steam",
      innerDiameterM: 0.6,
      ratedPressurePa: 6.4e6,
      ratedTemperatureK: 560,
    },
    sensor: control("measurement"),
  },
  "steam-turbine": {
    steam: {
      domain: "fluid",
      label: "STEAM IN",
      direction: "in",
      fluid: "steam",
      innerDiameterM: 0.6,
      ratedPressurePa: 6.4e6,
      ratedTemperatureK: 560,
    },
    shaft: shaft("out", 1e9),
  },
  generator: { shaft: shaft("in", 1e9), power: power("out", 50_000) },
  sensor: { signal: control("measurement", "SIGNAL") },
  interlock: { signal: control("interlock", "SENSOR / TRIP BUS") },
};

/* ---------------- product sheets ---------------- */

const structuralSheet = (
  summary: string,
  visual: ProductInfo["visual"],
  substanceId: string,
): ProductInfo => ({
  summary,
  internals: [
    {
      id: "section",
      name: "Rolled section",
      substanceId,
      purpose: "Carries load; its section and yield strength set capacity.",
    },
  ],
  internalsSetMass: false,
  capabilities: ["structural", "thermal"],
  ratings: () => [],
  failureModes: [
    {
      id: "yield",
      name: "Yield",
      system: "structural",
      description: "Compressive stress exceeds the allowable stress.",
    },
    {
      id: "buckling",
      name: "Buckling",
      system: "structural",
      description: "A slender column fails sideways below yield.",
    },
    {
      id: "bending",
      name: "Bending yield",
      system: "structural",
      description: "Peak fibre stress in a span exceeds the allowable.",
    },
  ],
  audio: "structure",
  visual,
  animations: [],
});

export const V01_PRODUCTS: Readonly<Record<string, ProductInfo>> = {
  "structural-beam": structuralSheet(
    "Square hollow section for frames, columns and supports.",
    "beam",
    "structural-steel",
  ),
  "structural-platform": structuralSheet(
    "Stiffened steel deck that spreads equipment loads onto columns.",
    "platform",
    "structural-steel",
  ),
  "equipment-block": structuralSheet(
    "Placeholder mass for equipment that has no model yet.",
    "block",
    "aluminum",
  ),
  "reactor-chamber": {
    summary: "Cylindrical 316L vacuum chamber for linear (open-field) plasma experiments.",
    internals: [
      {
        id: "wall",
        name: "Vacuum wall",
        substanceId: "stainless-steel",
        purpose: "Holds vacuum against atmospheric pressure.",
      },
      {
        id: "first-wall",
        name: "First-wall cooling channels",
        substanceId: "stainless-steel",
        purpose: "Carries plasma exhaust heat to the coolant.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["structural", "thermal", "vacuum", "plasma", "fluid"],
    ratings: (p) => [rating("Leak rate", `${n(p, "leakRatePaM3PerS").toExponential(1)} Pa·m³/s`)],
    failureModes: [
      {
        id: "overheat",
        name: "Wall over-temperature",
        system: "thermal",
        description: "Plasma exhaust exceeds what the cooling removes.",
      },
      {
        id: "no-breakdown",
        name: "No breakdown",
        system: "vacuum",
        description: "Pressure or field not low/high enough to start a plasma.",
      },
    ],
    audio: "vessel",
    visual: "linear-chamber",
    animations: [{ id: "glow", source: "plasma.temperatureKeV" }],
  },
  "tokamak-vessel": {
    summary:
      "Toroidal double-wall vacuum vessel: holds the plasma, forms the first wall, and is cooled.",
    internals: [
      {
        id: "shell",
        name: "Double-wall 316L shell",
        substanceId: "stainless-steel",
        purpose: "Vacuum boundary and primary structure.",
      },
      {
        id: "first-wall",
        name: "Tungsten-armoured first wall",
        substanceId: "tungsten",
        purpose: "Faces the plasma; takes radiation and particle heat.",
      },
      {
        id: "channels",
        name: "Coolant channels",
        substanceId: "stainless-steel",
        purpose: "Remove wall heat into the primary loop.",
      },
      {
        id: "diagnostics",
        name: "Diagnostic ports",
        substanceId: "stainless-steel",
        purpose: "Magnetics, bolometry and interferometry access.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["structural", "thermal", "vacuum", "plasma", "fluid", "nuclear"],
    ratings: (p) => [
      rating("Plasma current", `${(n(p, "plasmaCurrentA") / 1e6).toFixed(1)} MA`),
      rating("Elongation", n(p, "elongation").toFixed(2)),
    ],
    failureModes: [
      {
        id: "disruption",
        name: "Disruption",
        system: "plasma",
        description:
          "Stability limit crossed; thermal and magnetic energy hit the wall in milliseconds.",
      },
      {
        id: "overheat",
        name: "Wall over-temperature",
        system: "thermal",
        description: "Exhaust heat exceeds cooling.",
      },
      {
        id: "no-breakdown",
        name: "No breakdown",
        system: "vacuum",
        description: "Pressure, field or fuel not ready.",
      },
    ],
    audio: "vessel",
    visual: "tokamak-vessel",
    animations: [{ id: "glow", source: "plasma.temperatureKeV" }],
  },
  "tf-coil-set": {
    summary:
      "Superconducting toroidal-field winding in a steel case: makes the field that confines the plasma.",
    internals: [
      {
        id: "case",
        name: "316L coil case",
        substanceId: "stainless-steel",
        purpose: "Reacts the enormous magnetic hoop force.",
      },
      {
        id: "winding",
        name: "Nb₃Sn superconducting strands",
        substanceId: "nb3sn",
        purpose:
          "Carries the coil current with no resistance while it stays below its critical surface.",
      },
      {
        id: "stabiliser",
        name: "Copper stabiliser",
        substanceId: "copper-ofhc",
        purpose: "Carries current during a quench while protection dumps the energy.",
      },
      {
        id: "insulation",
        name: "Ground insulation",
        substanceId: "g10-cr",
        purpose: "Insulates the winding from the case.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["magnetic", "cryogenic", "electrical", "structural", "thermal"],
    ratings: (p) => [
      rating("Current", `${(n(p, "currentA") / 1e3).toFixed(0)} kA`),
      rating("Turns", n(p, "turns").toFixed(0)),
      rating("Refrigeration", kw(n(p, "cryoCapacityW"))),
    ],
    failureModes: [
      {
        id: "quench",
        name: "Quench",
        system: "magnetic",
        description:
          "Cold mass warms past the critical temperature; the coil turns resistive and dumps its current.",
      },
      {
        id: "hoop",
        name: "Hoop overstress",
        system: "magnetic",
        description: "Magnetic force exceeds what the case can carry.",
      },
    ],
    audio: "magnet",
    visual: "tf-coils",
    animations: [{ id: "frost", source: "magnet.currentA" }],
  },
  "solenoid-coil": {
    summary: "Water-cooled copper solenoid for linear devices.",
    internals: [
      {
        id: "winding",
        name: "Copper winding",
        substanceId: "copper",
        purpose: "Carries the coil current; dissipates I²R.",
      },
      {
        id: "case",
        name: "Steel former",
        substanceId: "stainless-steel",
        purpose: "Supports the winding.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["magnetic", "electrical", "thermal", "fluid"],
    ratings: (p) => [
      rating("Current", `${(n(p, "currentA") / 1e3).toFixed(1)} kA`),
      rating("Turns", n(p, "turns").toFixed(0)),
    ],
    failureModes: [
      {
        id: "overheat",
        name: "Over-temperature",
        system: "thermal",
        description: "I²R heating exceeds cooling.",
      },
    ],
    audio: "magnet",
    visual: "solenoid",
    animations: [],
  },
  "fuel-injector": {
    summary: "Gas and pellet fuelling system with density feedback for a D–T plasma.",
    internals: [
      {
        id: "valves",
        name: "Piezo gas valves",
        substanceId: "stainless-steel",
        purpose: "Meter D–T gas into the vessel.",
      },
      {
        id: "pellet",
        name: "Pellet injector",
        substanceId: "stainless-steel",
        purpose: "Fires frozen fuel pellets deep into the plasma.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["plasma", "electrical", "control"],
    ratings: (p) => [rating("Target density", `${n(p, "targetDensityM3").toExponential(1)} m⁻³`)],
    failureModes: [
      {
        id: "density-limit",
        name: "Over-fuelling",
        system: "plasma",
        description: "Density above the Greenwald limit disrupts the plasma.",
      },
    ],
    audio: "injector",
    visual: "fuel-injector",
    animations: [{ id: "indicator", source: "outputs.fuelingRatePerS" }],
  },
  "neutral-beam": {
    summary: "Neutral-beam injector: accelerates and neutralises ions to heat the plasma.",
    internals: [
      { id: "source", name: "Ion source", substanceId: "copper", purpose: "Makes the ion beam." },
      {
        id: "accelerator",
        name: "Accelerator grids",
        substanceId: "copper",
        purpose: "Accelerates ions to beam energy.",
      },
      {
        id: "neutraliser",
        name: "Gas neutraliser",
        substanceId: "stainless-steel",
        purpose: "Turns the ion beam into neutrals that cross the field.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["plasma", "electrical"],
    ratings: (p) => [
      rating("Heating power", mw(n(p, "heatingPowerW"))),
      rating("Wall-plug efficiency", `${(n(p, "wallPlugEfficiency") * 100).toFixed(0)} %`),
    ],
    failureModes: [
      {
        id: "starved",
        name: "Supply shortfall",
        system: "electrical",
        description: "Less power delivered than demanded; heating falls.",
      },
    ],
    audio: "beam-heater",
    visual: "neutral-beam",
    animations: [{ id: "glow", source: "electrical.deliveredW" }],
  },
  "vacuum-pump": {
    summary: "Cryopump bank that holds the vessel at base pressure.",
    internals: [
      {
        id: "panels",
        name: "Charcoal-coated cryopanels",
        substanceId: "copper",
        purpose: "Trap gas by cryosorption.",
      },
      {
        id: "valve",
        name: "Gate valve",
        substanceId: "stainless-steel",
        purpose: "Isolates the pump for regeneration.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["vacuum", "electrical"],
    ratings: (p) => [rating("Pumping speed", `${n(p, "pumpingSpeedM3PerS").toFixed(0)} m³/s`)],
    failureModes: [
      {
        id: "pressure",
        name: "Pressure too high",
        system: "vacuum",
        description: "Gas load exceeds pumping; breakdown is impossible.",
      },
    ],
    audio: "vacuum-pump",
    visual: "cryopump",
    animations: [{ id: "fan", source: "electrical.deliveredW" }],
  },
  "grid-connection": {
    summary: "Grid intake with rectifier: a regulated 20 kV DC plant bus.",
    internals: [
      {
        id: "transformer",
        name: "Step-down transformer",
        substanceId: "copper",
        purpose: "Takes grid voltage down.",
      },
      {
        id: "rectifier",
        name: "Rectifier",
        substanceId: "copper",
        purpose: "Converts to regulated DC.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["electrical"],
    ratings: (p) => [
      rating("Voltage", `${(n(p, "voltageV") / 1e3).toFixed(0)} kV`),
      rating("Capacity", mw(n(p, "maxPowerW"))),
    ],
    failureModes: [
      {
        id: "overload",
        name: "Overload",
        system: "electrical",
        description: "Demand exceeds capacity; voltage sags and loads are starved.",
      },
    ],
    audio: "grid",
    visual: "grid-connection",
    animations: [],
  },
  "bus-bar": {
    summary: "Copper bus bar distributing DC power.",
    internals: [
      {
        id: "conductor",
        name: "Copper bar",
        substanceId: "copper",
        purpose: "Carries current; R = ρL/A.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["electrical", "thermal"],
    ratings: (p) => [rating("Cross-section", `${(n(p, "crossSectionM2") * 1e6).toFixed(0)} mm²`)],
    failureModes: [
      {
        id: "burnout",
        name: "Burn-out",
        system: "thermal",
        description: "I²R heating exceeds the conductor's limit; it stops conducting.",
      },
    ],
    audio: "none",
    visual: "bus-bar",
    animations: [],
  },
  breaker: {
    summary: "DC circuit breaker; interlocks can open it.",
    internals: [
      {
        id: "contacts",
        name: "Contacts and arc chute",
        substanceId: "copper",
        purpose: "Make and break the circuit.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["electrical", "control"],
    ratings: () => [rating("Rating", "20 kV DC")],
    failureModes: [],
    audio: "switchgear",
    visual: "breaker",
    animations: [{ id: "indicator", source: "outputs.closedFlag" }],
  },
  "breeding-blanket": {
    summary: "Water-cooled blanket and shield: captures neutron energy and protects the coils.",
    internals: [
      {
        id: "shield",
        name: "Steel shield blocks",
        substanceId: "stainless-steel",
        purpose: "Attenuate neutrons before they reach the coils.",
      },
      {
        id: "channels",
        name: "Coolant channels",
        substanceId: "stainless-steel",
        purpose: "Carry deposited heat to the primary loop.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["nuclear", "thermal", "fluid"],
    ratings: (p) => [
      rating("Energy multiplication", `×${n(p, "energyMultiplication").toFixed(2)}`),
    ],
    failureModes: [
      {
        id: "overheat",
        name: "Over-temperature",
        system: "thermal",
        description: "Neutron heating exceeds cooling.",
      },
    ],
    audio: "none",
    visual: "blanket",
    animations: [],
  },
  "coolant-pipe": {
    summary:
      "Steel coolant pipe. Its bore and length set the friction loss the pump must overcome.",
    internals: [
      {
        id: "wall",
        name: "Pipe wall",
        substanceId: "structural-steel",
        purpose: "Contains the pressurised coolant.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["fluid", "thermal", "structural"],
    ratings: () => [rating("Holds", "loop pressure + pump head")],
    failureModes: [
      {
        id: "restriction",
        name: "Flow restriction",
        system: "fluid",
        description: "Too narrow or too long: the loop cannot reach its rated flow.",
      },
      {
        id: "rupture",
        name: "Pressure rupture",
        system: "fluid",
        description:
          "Hoop stress from the loop pressure exceeds the wall's yield at its temperature: the wall tears and the loop blows down.",
      },
    ],
    audio: "pipe",
    visual: "pipe",
    animations: [],
  },
  "coolant-pump": {
    summary: "Centrifugal circulating pump for the primary coolant loop.",
    internals: [
      {
        id: "motor",
        name: "Induction motor",
        substanceId: "copper",
        purpose: "Drives the impeller.",
      },
      {
        id: "impeller",
        name: "Impeller",
        substanceId: "stainless-steel",
        purpose: "Adds head to the coolant.",
      },
      {
        id: "casing",
        name: "Volute casing",
        substanceId: "stainless-steel",
        purpose: "Contains pressure and directs flow.",
      },
      {
        id: "seals",
        name: "Shaft seals and bearings",
        substanceId: "stainless-steel",
        purpose: "Keep coolant in and the shaft true.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["fluid", "electrical", "thermal"],
    ratings: (p) => [
      rating("Rated flow", `${n(p, "ratedMassFlowKgS").toFixed(0)} kg/s`),
      rating("Rated head", `${n(p, "ratedHeadM").toFixed(0)} m`),
    ],
    failureModes: [
      {
        id: "loss-of-flow",
        name: "Loss of flow",
        system: "fluid",
        description: "Switched off, unpowered or unable to overcome the loop's resistance.",
      },
      {
        id: "seizure",
        name: "Seizure",
        system: "thermal",
        description: "Over-temperature seizes the pump.",
      },
    ],
    audio: "pump",
    visual: "pump",
    animations: [{ id: "impeller", source: "coolant.massFlowKgS" }],
  },
  "steam-generator": {
    summary: "Shell-and-tube steam generator: primary heat boils secondary water for the turbine.",
    internals: [
      {
        id: "tubes",
        name: "Tube bundle",
        substanceId: "stainless-steel",
        purpose: "Transfers heat between loops.",
      },
      {
        id: "shell",
        name: "Pressure shell",
        substanceId: "stainless-steel",
        purpose: "Holds the secondary side.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["thermal", "fluid"],
    ratings: (p) => [
      rating("Conductance", `${(n(p, "secondaryConductanceWK") / 1e6).toFixed(0)} MW/K`),
    ],
    failureModes: [],
    audio: "heat-exchanger",
    visual: "steam-generator",
    animations: [],
  },
  "steam-turbine": {
    summary: "Steam turbine: converts cycle heat to shaft power.",
    internals: [
      {
        id: "rotor",
        name: "Bladed rotor",
        substanceId: "structural-steel",
        purpose: "Extracts work from expanding steam.",
      },
      {
        id: "casing",
        name: "Casing",
        substanceId: "structural-steel",
        purpose: "Contains the steam path.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["thermal", "mechanical"],
    ratings: (p) => [
      rating("Thermal rating", mw(n(p, "ratedThermalPowerW"))),
      rating("Live steam", `${n(p, "steamTemperatureK").toFixed(0)} K`),
    ],
    failureModes: [],
    audio: "turbine",
    visual: "turbine",
    animations: [{ id: "rotor", source: "outputs.shaftPowerW" }],
  },
  generator: {
    summary: "Synchronous generator feeding the plant bus.",
    internals: [
      {
        id: "stator",
        name: "Copper stator winding",
        substanceId: "copper",
        purpose: "Where the power is generated.",
      },
      {
        id: "rotor",
        name: "Field rotor",
        substanceId: "structural-steel",
        purpose: "Turned by the turbine shaft.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["electrical", "mechanical"],
    ratings: (p) => [
      rating("Rating", mw(n(p, "ratedPowerW"))),
      rating("Efficiency", `${(n(p, "efficiency") * 100).toFixed(1)} %`),
    ],
    failureModes: [],
    audio: "generator",
    visual: "generator",
    animations: [{ id: "rotor", source: "electrical.suppliedW" }],
  },
  sensor: {
    summary: "Instrument that reports one quantity from the component it is linked to.",
    internals: [
      {
        id: "transducer",
        name: "Transducer and electronics",
        substanceId: "aluminum",
        purpose: "Measures and transmits.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["control"],
    ratings: () => [],
    failureModes: [],
    audio: "none",
    visual: "sensor",
    animations: [],
  },
  interlock: {
    summary: "Protection controller: trips at a setpoint and latches until reset.",
    internals: [
      {
        id: "logic",
        name: "Safety PLC",
        substanceId: "aluminum",
        purpose: "Evaluates trips and commands actuators.",
      },
    ],
    internalsSetMass: false,
    capabilities: ["control"],
    ratings: () => [],
    failureModes: [
      {
        id: "trip",
        name: "Interlock trip",
        system: "control",
        description: "A linked sensor crossed the setpoint.",
      },
    ],
    audio: "controller",
    visual: "controller",
    animations: [{ id: "indicator", source: "outputs.trippedFlag" }],
  },
};
