/**
 * Physical roles and their parameters.
 *
 * A component's `role` tells the plant solvers what physics applies to it; its
 * `parameters` are the operating values a builder may set. Both are owned here, in
 * sim-core, because they define physical truth: the catalogue in
 * `@forgelab/reactor-components` only chooses a role and preset values for each part.
 *
 * Every parameter is stored in base SI with a unit suffix on its key, like every other
 * quantity in ForgeLab. `display` only tells an interface how to show it.
 */
export const PLANT_ROLES = Object.freeze([
  "structure",
  "vacuum-vessel",
  "magnet-coil",
  "fuel-injector",
  "plasma-heater",
  "vacuum-pump",
  "power-supply",
  "conductor",
  "switch",
  "coolant-pipe",
  "coolant-pump",
  "heat-exchanger",
  "blanket",
  "turbine",
  "generator",
  "sensor",
  "controller",
] as const);

export type PlantRole = (typeof PLANT_ROLES)[number];

export function isPlantRole(value: unknown): value is PlantRole {
  return typeof value === "string" && (PLANT_ROLES as readonly string[]).includes(value);
}

export type ParameterValue = number | boolean | string;
export type ComponentParameters = Readonly<Record<string, ParameterValue>>;

interface ParameterBase {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** Shown only under "Advanced" in the inspector. */
  readonly advanced?: boolean;
}

export interface NumberParameterSpec extends ParameterBase {
  readonly kind: "number";
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  /** How an interface should present the SI value: shown = SI × scale, in `unit`. */
  readonly display: { readonly unit: string; readonly scale: number; readonly step?: number };
}

export interface BooleanParameterSpec extends ParameterBase {
  readonly kind: "boolean";
  readonly defaultValue: boolean;
}

export interface EnumParameterSpec extends ParameterBase {
  readonly kind: "enum";
  readonly defaultValue: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export type ParameterSpec = NumberParameterSpec | BooleanParameterSpec | EnumParameterSpec;

const num = (
  key: string,
  label: string,
  defaultValue: number,
  min: number,
  max: number,
  unit: string,
  scale: number,
  description: string,
  advanced = false,
): NumberParameterSpec => ({
  kind: "number",
  key,
  label,
  defaultValue,
  min,
  max,
  display: { unit, scale },
  description,
  ...(advanced ? { advanced } : {}),
});

const bool = (key: string, label: string, defaultValue: boolean, description: string) =>
  ({ kind: "boolean", key, label, defaultValue, description }) as BooleanParameterSpec;

const enumeration = (
  key: string,
  label: string,
  defaultValue: string,
  options: readonly { value: string; label: string }[],
  description: string,
): EnumParameterSpec => ({ kind: "enum", key, label, defaultValue, options, description });

const ENABLED = bool("enabled", "Enabled", true, "Whether the unit is switched on.");

/** Parameters shared by every component that has internal coolant channels. */
const COOLANT_CHANNEL: readonly ParameterSpec[] = [
  num(
    "coolantConductanceWK",
    "Coolant heat-transfer UA",
    5e6,
    0,
    1e9,
    "MW/K",
    1e-6,
    "Overall heat-transfer coefficient times area between the component and its coolant. Enters the effectiveness ε = 1 − exp(−UA / ṁc_p).",
    true,
  ),
  num(
    "channelDiameterM",
    "Channel hydraulic diameter",
    0.3,
    0.005,
    3,
    "mm",
    1e3,
    "Hydraulic diameter of the internal coolant passages, used for the Darcy–Weisbach pressure drop.",
    true,
  ),
  num(
    "channelLengthM",
    "Channel length",
    10,
    0,
    1e4,
    "m",
    1,
    "Flow length of the internal coolant passages.",
    true,
  ),
  num(
    "channelLossCoefficient",
    "Channel minor-loss coefficient K",
    5,
    0,
    1000,
    "",
    1,
    "Sum of minor-loss coefficients (bends, manifolds) inside the component.",
    true,
  ),
];

export const ROLE_PARAMETERS: Readonly<Record<PlantRole, readonly ParameterSpec[]>> = Object.freeze(
  {
    structure: [],

    "vacuum-vessel": [
      num(
        "plasmaCurrentA",
        "Plasma current",
        15e6,
        0,
        25e6,
        "MA",
        1e-6,
        "Target toroidal plasma current. Assumed driven by an idealised central solenoid whose flux consumption V0.1 does not model. Ignored by linear (cylindrical) vessels.",
      ),
      num(
        "plasmaCurrentRampAPerS",
        "Current ramp rate",
        0.5e6,
        1e4,
        5e6,
        "MA/s",
        1e-6,
        "Rate at which the plasma current is ramped up after breakdown.",
        true,
      ),
      num(
        "elongation",
        "Plasma elongation κ",
        1.7,
        1,
        2.4,
        "",
        1,
        "Vertical elongation of the plasma cross-section. Enters the plasma volume, confinement scaling and safety factor.",
      ),
      num(
        "plasmaFillFraction",
        "Plasma / vessel radius",
        0.9,
        0.5,
        0.98,
        "",
        1,
        "Plasma minor radius as a fraction of the vessel's inner tube radius (the rest is the gap to the wall).",
        true,
      ),
      num(
        "effectiveCharge",
        "Effective charge Z_eff",
        1.5,
        1,
        4,
        "",
        1,
        "Impurity content. Raises bremsstrahlung losses and plasma resistivity.",
        true,
      ),
      num(
        "outgassingPaM3PerSM2",
        "Wall outgassing rate",
        1e-7,
        0,
        1e-3,
        "Pa·m³/(s·m²)",
        1,
        "Gas released per unit wall area. Unbaked 316L after ~10 h pumping is of order 1e-8–1e-7 (O'Hanlon, A User's Guide to Vacuum Technology).",
        true,
      ),
      num(
        "leakRatePaM3PerS",
        "Leak rate",
        1e-7,
        0,
        1e3,
        "Pa·m³/s",
        1,
        "Air leaking in through seals and welds.",
        true,
      ),
      ...COOLANT_CHANNEL,
    ],

    "magnet-coil": [
      num(
        "turns",
        "Total turns",
        2412,
        1,
        100000,
        "turns",
        1,
        "Total number of turns. For a toroidal-field coil set, summed over every coil (ITER: 18 × 134).",
      ),
      num(
        "currentA",
        "Current per turn",
        68000,
        0,
        200000,
        "kA",
        1e-3,
        "Operating current in each turn. Field ∝ N·I.",
      ),
      bool(
        "superconducting",
        "Superconducting",
        true,
        "Superconducting coils dissipate no ohmic power but must stay below their critical temperature, which costs cryogenic refrigeration. Resistive (copper) coils dissipate I²R.",
      ),
      enumeration(
        "conductor",
        "Superconductor",
        "rated",
        [
          { value: "rated", label: "Rated critical temperature" },
          { value: "nbti", label: "NbTi (critical surface)" },
        ],
        "Rated: the coil quenches above the fixed critical temperature below. NbTi: the quench temperature is NbTi's critical temperature at the coil's live peak field (Bottura 2000 fit, Tc0 = 9.2 K, Bc20 = 14.5 T), so more ampere-turns leave less temperature margin, and above 14.5 T it cannot superconduct at all.",
      ),
      num(
        "operatingTemperatureK",
        "Operating temperature",
        4.5,
        2,
        80,
        "K",
        1,
        "Cold-mass temperature for a superconducting coil (4.5 K for Nb₃Sn/NbTi, ~20 K for REBCO).",
        true,
      ),
      num(
        "criticalTemperatureK",
        "Critical temperature",
        18,
        4,
        93,
        "K",
        1,
        "Temperature above which a Rated conductor quenches. 18 K is the zero-field value for Nb₃Sn; the in-field value is lower, so this is optimistic. Ignored for NbTi, whose limit follows its field.",
        true,
      ),
      num(
        "cryoCapacityW",
        "Cryoplant capacity",
        30e3,
        0,
        1e6,
        "kW",
        1e-3,
        "Refrigeration available at the operating temperature. The cryoplant draws this capacity × (T_ambient/T_op − 1) / (fraction of Carnot) of electricity.",
      ),
      num(
        "staticHeatLeakW",
        "Static heat leak",
        10e3,
        0,
        1e6,
        "kW",
        1e-3,
        "Heat reaching the cold mass through supports, current leads and thermal radiation.",
        true,
      ),
      num(
        "cryoFractionOfCarnot",
        "Cryoplant fraction of Carnot",
        0.25,
        0.05,
        0.6,
        "",
        1,
        "Large helium refrigerators reach roughly 20–30 % of Carnot efficiency.",
        true,
      ),
      num(
        "coldMassSpecificHeatJkgK",
        "Cold-mass effective specific heat",
        5,
        0.1,
        100,
        "J/(kg·K)",
        1,
        "Average specific heat of the cold mass between operating and critical temperature. Metals at 4–20 K have specific heats of ~0.1–10 J/(kg·K) (NIST cryogenic material data), far below room-temperature values.",
        true,
      ),
      num(
        "conductorAreaM2",
        "Conductor area per turn",
        6e-4,
        1e-6,
        0.1,
        "mm²",
        1e6,
        "Copper cross-section of one turn, used for the resistive coil's R = ρ·N·l_turn / A.",
        true,
      ),
      num(
        "dumpTimeConstantS",
        "Quench dump time constant",
        11,
        0.1,
        100,
        "s",
        1,
        "Time constant of the current decay when protection dumps the coil's energy (ITER TF: ~11 s).",
        true,
      ),
      ENABLED,
      ...COOLANT_CHANNEL,
    ],

    "fuel-injector": [
      num(
        "targetDensityM3",
        "Target plasma density",
        1e20,
        1e18,
        5e21,
        "10²⁰ m⁻³",
        1e-20,
        "Density the injector's feedback controller fuels towards.",
      ),
      num(
        "maxRateParticlesPerS",
        "Maximum fuelling rate",
        2e22,
        0,
        1e24,
        "particles/s",
        1,
        "Largest ion throughput the gas and pellet systems can deliver.",
        true,
      ),
      num(
        "deuteriumFraction",
        "Deuterium fraction",
        0.5,
        0,
        1,
        "",
        1,
        "Share of deuterium in the injected fuel; the rest is tritium. 0.5 maximises D–T power.",
      ),
      num(
        "electricalPowerW",
        "Electrical demand",
        1e6,
        0,
        1e8,
        "MW",
        1e-6,
        "Power drawn by pellet injectors, gas valves and fuel-cycle plant.",
        true,
      ),
      ENABLED,
    ],

    "plasma-heater": [
      num(
        "heatingPowerW",
        "Heating power absorbed",
        50e6,
        0,
        500e6,
        "MW",
        1e-6,
        "Power delivered into the plasma by neutral beams or RF waves.",
      ),
      num(
        "wallPlugEfficiency",
        "Wall-plug efficiency",
        0.35,
        0.05,
        0.9,
        "",
        1,
        "Fraction of drawn electricity that reaches the plasma. Neutral-beam and RF systems typically achieve 0.3–0.5.",
      ),
      ENABLED,
    ],

    "vacuum-pump": [
      num(
        "pumpingSpeedM3PerS",
        "Pumping speed",
        50,
        0,
        1000,
        "m³/s",
        1,
        "Volumetric pumping speed at the vessel. Conductance of the duct is not modelled.",
      ),
      num(
        "electricalPowerW",
        "Electrical demand",
        2e5,
        0,
        1e7,
        "kW",
        1e-3,
        "Power drawn by the pump and its backing stage.",
        true,
      ),
      ENABLED,
    ],

    "power-supply": [
      num("voltageV", "Bus voltage", 20e3, 100, 500e3, "kV", 1e-3, "Regulated DC output voltage."),
      num(
        "maxPowerW",
        "Maximum power",
        1e9,
        0,
        1e10,
        "MW",
        1e-6,
        "Largest power the grid connection can import.",
      ),
      num(
        "internalResistanceOhm",
        "Source resistance",
        0.02,
        1e-5,
        100,
        "Ω",
        1,
        "Thevenin source resistance.",
        true,
      ),
      ENABLED,
    ],

    conductor: [
      num(
        "crossSectionM2",
        "Conductor cross-section",
        2e-3,
        1e-6,
        1,
        "mm²",
        1e6,
        "Current-carrying cross-section. Resistance R = ρL/A uses the part's material resistivity and its length.",
      ),
    ],

    switch: [bool("closed", "Closed", true, "A closed breaker conducts; an open one isolates.")],

    "coolant-pipe": [],

    "coolant-pump": [
      enumeration(
        "fluid",
        "Coolant",
        "pressurized-water",
        [
          { value: "pressurized-water", label: "Pressurised water" },
          { value: "helium", label: "Helium" },
        ],
        "The fluid this pump circulates. Every component in a loop carries the fluid of its pumps.",
      ),
      num(
        "ratedMassFlowKgS",
        "Rated mass flow",
        2000,
        0,
        50000,
        "kg/s",
        1,
        "Flow at the rated point of the pump curve.",
      ),
      num(
        "ratedHeadM",
        "Rated head",
        100,
        0,
        5000,
        "m",
        1,
        "Head at the rated point. Pressure rise = ρ g H.",
      ),
      num(
        "efficiency",
        "Pump efficiency",
        0.8,
        0.1,
        0.95,
        "",
        1,
        "Hydraulic and motor efficiency combined.",
        true,
      ),
      ENABLED,
    ],

    "heat-exchanger": [
      num(
        "secondaryConductanceWK",
        "Secondary-side UA",
        30e6,
        0,
        1e9,
        "MW/K",
        1e-6,
        "Heat-transfer conductance from the primary coolant to the secondary (steam) side.",
      ),
      ...COOLANT_CHANNEL,
    ],

    blanket: [
      num(
        "coverageFraction",
        "Coverage fraction",
        0.85,
        0,
        0.98,
        "",
        1,
        "Fraction of neutrons leaving the plasma that enter the blanket (the rest escape through ports and gaps).",
      ),
      num(
        "energyMultiplication",
        "Energy multiplication",
        1.18,
        1,
        1.5,
        "",
        1,
        "Blanket energy gain from exothermic neutron reactions in lithium and multipliers. Design studies quote ~1.1–1.35.",
        true,
      ),
      ...COOLANT_CHANNEL,
    ],

    turbine: [
      num(
        "steamTemperatureK",
        "Live-steam temperature",
        553,
        373,
        900,
        "K",
        1,
        "Saturation temperature of the steam raised in the heat exchanger. Primary coolant must be hotter than this to transfer heat.",
      ),
      num(
        "condenserTemperatureK",
        "Condenser temperature",
        308,
        280,
        400,
        "K",
        1,
        "Cold-side temperature of the cycle.",
        true,
      ),
      num(
        "fractionOfCarnot",
        "Fraction of Carnot",
        0.75,
        0.3,
        0.95,
        "",
        1,
        "Cycle efficiency relative to Carnot between steam and condenser temperatures; steam plants reach ~0.6–0.8.",
        true,
      ),
      num(
        "ratedThermalPowerW",
        "Rated thermal power",
        4e9,
        0,
        1e10,
        "MW",
        1e-6,
        "Largest heat flow the turbine can accept.",
      ),
    ],

    generator: [
      num(
        "efficiency",
        "Generator efficiency",
        0.985,
        0.8,
        0.995,
        "",
        1,
        "Large synchronous generators reach ~98–99 %.",
        true,
      ),
      num("voltageV", "Output voltage", 20e3, 100, 500e3, "kV", 1e-3, "Regulated DC bus voltage."),
      num("ratedPowerW", "Rated power", 2e9, 0, 1e10, "MW", 1e-6, "Largest electrical output."),
      num(
        "internalResistanceOhm",
        "Source resistance",
        0.02,
        1e-5,
        100,
        "Ω",
        1,
        "Thevenin source resistance.",
        true,
      ),
    ],

    sensor: [
      enumeration(
        "quantity",
        "Measures",
        "temperature",
        [
          { value: "temperature", label: "Temperature (K)" },
          { value: "coolant-flow", label: "Coolant flow (kg/s)" },
          { value: "pressure", label: "Vessel pressure (Pa)" },
          { value: "fusion-power", label: "Fusion power (W)" },
          { value: "field", label: "Magnetic field (T)" },
        ],
        "The quantity read from the component the sensor is linked to.",
      ),
    ],

    controller: [
      num(
        "setpoint",
        "Trip setpoint",
        700,
        -1e12,
        1e12,
        "SI",
        1,
        "Threshold compared against every linked sensor reading, in that sensor's SI unit.",
      ),
      enumeration(
        "comparison",
        "Trip when reading is",
        "above",
        [
          { value: "above", label: "Above setpoint" },
          { value: "below", label: "Below setpoint" },
        ],
        "Direction of the comparison.",
      ),
      enumeration(
        "action",
        "Action",
        "shutdown-plasma",
        [
          { value: "shutdown-plasma", label: "Controlled plasma shutdown" },
          { value: "stop-heating", label: "Switch off linked heaters only" },
          { value: "open-breakers", label: "Open linked breakers" },
        ],
        "What the interlock does once tripped. It latches until the run is reset.",
      ),
    ],
  },
);

/**
 * Fills in defaults and validates. Unknown keys are dropped; out-of-range numbers are
 * clamped into range; wrong types fall back to the default. Deterministic and total, so
 * a save file edited by hand can never inject a non-physical value.
 */
export function resolveParameters(
  role: PlantRole,
  input: Readonly<Record<string, unknown>> = {},
): ComponentParameters {
  const result: Record<string, ParameterValue> = {};
  for (const spec of ROLE_PARAMETERS[role]) {
    const raw = input[spec.key];
    switch (spec.kind) {
      case "number": {
        const value = typeof raw === "number" && Number.isFinite(raw) ? raw : spec.defaultValue;
        result[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
        break;
      }
      case "boolean":
        result[spec.key] = typeof raw === "boolean" ? raw : spec.defaultValue;
        break;
      case "enum":
        result[spec.key] =
          typeof raw === "string" && spec.options.some((option) => option.value === raw)
            ? raw
            : spec.defaultValue;
        break;
    }
  }
  return Object.freeze(result);
}

export function numberParameter(parameters: ComponentParameters, key: string): number {
  const value = parameters[key];
  return typeof value === "number" ? value : 0;
}

export function booleanParameter(parameters: ComponentParameters, key: string): boolean {
  return parameters[key] === true;
}

export function stringParameter(parameters: ComponentParameters, key: string): string {
  const value = parameters[key];
  return typeof value === "string" ? value : "";
}

/** Roles whose components have internal coolant passages. */
export const COOLED_ROLES: ReadonlySet<PlantRole> = new Set<PlantRole>([
  "vacuum-vessel",
  "magnet-coil",
  "heat-exchanger",
  "blanket",
]);
