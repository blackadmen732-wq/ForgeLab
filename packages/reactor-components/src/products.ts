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
      kind: "structure",
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
        name: "Chamber wall",
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Holds the vacuum against atmospheric pressure.",
      },
      {
        id: "limiter",
        name: "Tungsten limiter",
        kind: "plasma-facing",
        substanceId: "tungsten",
        purpose: "Takes the heat at the plasma's edge.",
      },
      {
        id: "plasma",
        name: "Plasma column",
        kind: "vacuum",
        substanceId: "dt-fuel",
        purpose: "Fuel at a few pascals, ionised into plasma.",
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
        id: "outer-shell",
        name: "Outer shell",
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Outer skin of the double-walled vacuum vessel.",
      },
      {
        id: "shield-water",
        name: "Shielding water",
        kind: "coolant",
        substanceId: "water",
        purpose: "Fills the gap between the shells: removes nuclear heat and slows neutrons.",
      },
      {
        id: "inner-shell",
        name: "Inner shell",
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Inner skin; the vacuum boundary.",
      },
      {
        id: "first-wall",
        name: "First-wall armour",
        kind: "plasma-facing",
        substanceId: "tungsten",
        purpose: "Faces the plasma and takes its radiated and particle heat.",
      },
      {
        id: "plasma",
        name: "Plasma volume",
        kind: "vacuum",
        substanceId: "dt-fuel",
        purpose: "Pumped to high vacuum, then fuelled to a few pascals and ionised.",
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
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Reacts the enormous magnetic hoop force.",
      },
      {
        id: "insulation",
        name: "Ground insulation",
        kind: "insulation",
        substanceId: "g10-cr",
        purpose: "Insulates the winding from the case.",
      },
      {
        id: "winding",
        name: "Nb₃Sn superconducting strands",
        kind: "superconductor",
        substanceId: "nb3sn",
        purpose:
          "Carries the coil current with no resistance while it stays below its critical surface.",
      },
      {
        id: "stabiliser",
        name: "Copper stabiliser",
        kind: "conductor",
        substanceId: "copper-ofhc",
        purpose: "Carries current during a quench while protection dumps the energy.",
      },
      {
        id: "turn-insulation",
        name: "Turn insulation",
        kind: "insulation",
        substanceId: "kapton",
        purpose: "Polyimide wrap insulating each turn from the next.",
      },
      {
        id: "helium",
        name: "Helium coolant channel",
        kind: "cryogen",
        substanceId: "helium",
        purpose: "Helium flowing through each cable keeps the conductor at about 4.5 K.",
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
        id: "former",
        name: "Steel former",
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Supports the winding against its own magnetic force.",
      },
      {
        id: "insulation",
        name: "Turn insulation",
        kind: "insulation",
        substanceId: "g10-cr",
        purpose: "Glass-epoxy between turns.",
      },
      {
        id: "winding",
        name: "Copper winding",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Carries the coil current; dissipates I²R.",
      },
      {
        id: "water",
        name: "Cooling water",
        kind: "coolant",
        substanceId: "water",
        purpose: "Flows through the hollow conductor and carries the I²R heat away.",
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
        id: "cabinet",
        name: "Cabinet",
        kind: "structure",
        substanceId: "aluminum",
        purpose: "Houses the gas system.",
      },
      {
        id: "deuterium",
        name: "Deuterium supply",
        kind: "fuel",
        substanceId: "deuterium",
        purpose: "Stored deuterium gas.",
      },
      {
        id: "tritium",
        name: "Tritium supply",
        kind: "fuel",
        substanceId: "tritium",
        purpose: "Tritium from the plant's tritium system.",
      },
      {
        id: "valves",
        name: "Gas valves",
        kind: "moving",
        substanceId: null,
        materialNote: "Piezo-electric valves (not catalogued)",
        purpose: "Meter the fuel into the vessel.",
      },
      {
        id: "controller",
        name: "Fuelling controller",
        kind: "electronics",
        substanceId: null,
        materialNote: "Control electronics (not catalogued)",
        purpose: "Holds the target density.",
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
      {
        id: "source",
        name: "Ion source",
        kind: "conductor",
        substanceId: "copper",
        purpose: "RF plasma source producing deuterium ions.",
      },
      {
        id: "grids",
        name: "Accelerator grids",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Accelerate the ions to the beam energy.",
      },
      {
        id: "neutraliser",
        name: "Neutraliser gas cell",
        kind: "fuel",
        substanceId: "deuterium",
        purpose: "Fast ions pick up electrons from the gas and become neutral.",
      },
      {
        id: "magnet",
        name: "Residual-ion magnet",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Deflects the ions that stayed charged.",
      },
      {
        id: "dump",
        name: "Ion dump",
        kind: "structure",
        substanceId: "copper",
        purpose: "Water-cooled copper that absorbs the deflected ions.",
      },
      {
        id: "duct",
        name: "Drift duct",
        kind: "vacuum",
        substanceId: null,
        materialNote: "Vacuum",
        purpose: "Carries the neutral beam to the vessel.",
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
        id: "vessel",
        name: "Pump vessel",
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Vacuum housing.",
      },
      {
        id: "shield",
        name: "Radiation shield",
        kind: "structure",
        substanceId: "copper-ofhc",
        purpose: "Held near 80 K; screens the cold panels from room-temperature radiation.",
      },
      {
        id: "panels",
        name: "Cryopanels",
        kind: "structure",
        substanceId: "copper-ofhc",
        purpose: "Charcoal-coated panels where gas freezes and is trapped.",
      },
      {
        id: "helium",
        name: "Panel cooling",
        kind: "cryogen",
        substanceId: "helium",
        purpose: "Keeps the panels at a few kelvin.",
      },
      {
        id: "valve",
        name: "Gate valve",
        kind: "moving",
        substanceId: "stainless-steel",
        purpose: "Isolates the pump from the vessel for regeneration.",
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
        id: "tank",
        name: "Transformer tank",
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Holds the active part and its oil.",
      },
      {
        id: "oil",
        name: "Insulating oil",
        kind: "coolant",
        substanceId: "mineral-oil",
        purpose: "Insulates and cools the windings.",
      },
      {
        id: "core",
        name: "Core",
        kind: "magnetic-core",
        substanceId: null,
        materialNote: "Grain-oriented electrical-steel laminations (not catalogued)",
        purpose: "Carries the magnetic flux linking the windings.",
      },
      {
        id: "winding",
        name: "Windings",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Primary and secondary windings.",
      },
      {
        id: "paper",
        name: "Winding insulation",
        kind: "insulation",
        substanceId: null,
        materialNote: "Oil-impregnated cellulose paper (not catalogued)",
        purpose: "Insulates turn from turn and winding from core.",
      },
      {
        id: "bushings",
        name: "Bushings",
        kind: "insulation",
        substanceId: null,
        materialNote: "Porcelain or composite (not catalogued)",
        purpose: "Bring the conductors out through the tank.",
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
        id: "bar",
        name: "Copper bar",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Carries the plant current.",
      },
      {
        id: "sleeve",
        name: "Insulating sleeve",
        kind: "insulation",
        substanceId: "xlpe",
        purpose: "Polymer insulation over the bar — the fire load if it overheats.",
      },
      {
        id: "supports",
        name: "Post insulators",
        kind: "insulation",
        substanceId: null,
        materialNote: "Porcelain (not catalogued)",
        purpose: "Hold the bar off its supports.",
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
        id: "enclosure",
        name: "Enclosure",
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Contains the switching chamber.",
      },
      {
        id: "contacts",
        name: "Main contacts",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Carry the current and part to interrupt it.",
      },
      {
        id: "arc-chute",
        name: "Arc chute",
        kind: "insulation",
        substanceId: null,
        materialNote: "Ceramic and steel splitter plates (not catalogued)",
        purpose: "Splits and cools the arc when the contacts part.",
      },
      {
        id: "mechanism",
        name: "Operating mechanism",
        kind: "moving",
        substanceId: "structural-steel",
        purpose: "Spring-charged drive that opens the contacts on a trip.",
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
        id: "armour",
        name: "First-wall armour",
        kind: "plasma-facing",
        substanceId: "tungsten",
        purpose: "Thin tungsten layer facing the plasma.",
      },
      {
        id: "first-wall",
        name: "First wall",
        kind: "structure",
        substanceId: "eurofer97",
        purpose: "Reduced-activation steel box wall.",
      },
      {
        id: "breeder",
        name: "Lithium-lead breeder",
        kind: "breeder",
        substanceId: "lithium-lead",
        purpose: "Breeds tritium from lithium-6 and multiplies neutrons.",
      },
      {
        id: "cooling",
        name: "Cooling tubes",
        kind: "coolant",
        substanceId: "water",
        purpose: "Pressurised water carries the neutron heat to the plant.",
      },
      {
        id: "manifold",
        name: "Back plate and manifolds",
        kind: "structure",
        substanceId: "eurofer97",
        purpose: "Distributes coolant and breeder, attaches the module.",
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
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Contains the pressurised coolant.",
      },
      {
        id: "coolant",
        name: "Coolant",
        kind: "coolant",
        substanceId: "water",
        purpose: "Pressurised water.",
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
        id: "casing",
        name: "Pressure casing",
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Contains the coolant at loop pressure.",
      },
      {
        id: "coolant",
        name: "Coolant cavity",
        kind: "coolant",
        substanceId: "water",
        purpose: "Water passing through the pump.",
      },
      {
        id: "impeller",
        name: "Impeller",
        kind: "moving",
        substanceId: "stainless-steel",
        purpose: "Spins to raise the coolant's pressure.",
      },
      {
        id: "shaft",
        name: "Shaft",
        kind: "moving",
        substanceId: "stainless-steel",
        purpose: "Couples the motor to the impeller.",
      },
      {
        id: "seal",
        name: "Shaft seal",
        kind: "moving",
        substanceId: "sic-cvd",
        purpose:
          "Mechanical seal faces that keep the coolant in where the shaft leaves the casing.",
      },
      {
        id: "bearings",
        name: "Bearings",
        kind: "moving",
        substanceId: null,
        materialNote: "Bearing steel (not catalogued)",
        purpose: "Carry the shaft.",
      },
      {
        id: "motor-winding",
        name: "Motor stator winding",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Drives the motor.",
      },
      {
        id: "motor-insulation",
        name: "Motor insulation",
        kind: "insulation",
        substanceId: null,
        materialNote: "Enamel and mica (not catalogued)",
        purpose: "Insulates the stator winding.",
      },
      {
        id: "drive",
        name: "Drive electronics",
        kind: "electronics",
        substanceId: null,
        materialNote: "Power electronics (not catalogued)",
        purpose: "Speed control.",
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
        id: "shell",
        name: "Pressure shell",
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Holds the secondary side at steam pressure.",
      },
      {
        id: "secondary",
        name: "Secondary water and steam",
        kind: "coolant",
        substanceId: "water",
        purpose: "Boils outside the tubes into steam for the turbine.",
      },
      {
        id: "tubes",
        name: "Tube bundle",
        kind: "structure",
        substanceId: null,
        materialNote: "Alloy 690 (not catalogued)",
        purpose: "Thousands of thin tubes: the heat passes through their walls.",
      },
      {
        id: "primary",
        name: "Primary coolant",
        kind: "coolant",
        substanceId: "water",
        purpose: "Hot pressurised water from the reactor inside the tubes.",
      },
      {
        id: "tubesheet",
        name: "Tube sheet",
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Thick plate the tubes are fixed into; separates the primary from the secondary.",
      },
      {
        id: "separators",
        name: "Moisture separators",
        kind: "structure",
        substanceId: "stainless-steel",
        purpose: "Dry the steam before it leaves.",
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
        id: "casing",
        name: "Casing",
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Contains the steam path.",
      },
      {
        id: "steam",
        name: "Steam path",
        kind: "coolant",
        substanceId: "water",
        purpose: "Steam expanding from live-steam to condenser pressure.",
      },
      {
        id: "blades",
        name: "Blades",
        kind: "moving",
        substanceId: null,
        materialNote: "12 % chromium blade steel (not catalogued)",
        purpose: "Extract work from the expanding steam.",
      },
      {
        id: "rotor",
        name: "Rotor",
        kind: "moving",
        substanceId: null,
        materialNote: "CrMoV rotor forging (not catalogued)",
        purpose: "Carries the blade discs; drives the generator.",
      },
      {
        id: "bearings",
        name: "Journal bearings",
        kind: "moving",
        substanceId: null,
        materialNote: "Babbitt-lined bearings (not catalogued)",
        purpose: "Carry the rotor.",
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
        id: "frame",
        name: "Frame",
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Holds the stator.",
      },
      {
        id: "core",
        name: "Stator core",
        kind: "magnetic-core",
        substanceId: null,
        materialNote: "Electrical-steel laminations (not catalogued)",
        purpose: "Carries the rotating magnetic flux.",
      },
      {
        id: "stator",
        name: "Copper stator winding",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Where the power is generated.",
      },
      {
        id: "stator-insulation",
        name: "Stator insulation",
        kind: "insulation",
        substanceId: null,
        materialNote: "Mica-epoxy groundwall (not catalogued)",
        purpose: "Insulates the high-voltage winding.",
      },
      {
        id: "rotor",
        name: "Field rotor",
        kind: "moving",
        substanceId: null,
        materialNote: "NiCrMoV rotor forging (not catalogued)",
        purpose: "Turned by the turbine shaft.",
      },
      {
        id: "field",
        name: "Field winding",
        kind: "conductor",
        substanceId: "copper",
        purpose: "Magnetises the rotor.",
      },
      {
        id: "gas",
        name: "Cooling gas",
        kind: "coolant",
        substanceId: null,
        materialNote: "Hydrogen or air (not catalogued)",
        purpose: "Carries heat out of the winding.",
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
        id: "housing",
        name: "Housing",
        kind: "structure",
        substanceId: "aluminum",
        purpose: "Protects the instrument.",
      },
      {
        id: "transducer",
        name: "Transducer",
        kind: "sensor",
        substanceId: null,
        materialNote: "Sensing element (not catalogued)",
        purpose: "Turns the measured quantity into a signal.",
      },
      {
        id: "electronics",
        name: "Signal electronics",
        kind: "electronics",
        substanceId: null,
        materialNote: "Electronics (not catalogued)",
        purpose: "Conditions and transmits the signal.",
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
        id: "cabinet",
        name: "Cabinet",
        kind: "structure",
        substanceId: "structural-steel",
        purpose: "Houses the protection system.",
      },
      {
        id: "logic",
        name: "Safety PLC",
        kind: "electronics",
        substanceId: null,
        materialNote: "Safety controller (not catalogued)",
        purpose: "Evaluates trips and commands actuators.",
      },
      {
        id: "relays",
        name: "Trip relays",
        kind: "moving",
        substanceId: null,
        materialNote: "Relays (not catalogued)",
        purpose: "Open the protected circuits on a trip.",
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
