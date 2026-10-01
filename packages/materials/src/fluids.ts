import type { Confidence, FluidRecord, Quantity } from "./schema.js";

/**
 * Fluids and gases. A fluid is not a solid with the strength missing: what matters is its
 * state (pressure and temperature), so its properties are recorded at named states.
 *
 * The "PWR primary" and "DEMO helium" states are exactly the operating states the
 * coolant solver in sim-core uses (its values are checked against these in the tests).
 */
function q(
  value: number,
  unit: string,
  source: string,
  confidence: Confidence,
  extra: { at?: string; range?: readonly [number, number]; note?: string } = {},
): Quantity {
  return { value, unit, source, confidence, ...extra };
}

const C = (celsius: number) => celsius + 273.15;

/** Tritium decay: λ = ln2 / T½, activity per gram = λ N_A / M, heat = activity × ⟨E_β⟩. */
const TRITIUM_HALF_LIFE_S = 12.32 * 365.25 * 86400;
const TRITIUM_MOLAR_G = 3.016;
const TRITIUM_ACTIVITY_BQ_PER_KG =
  ((Math.LN2 / TRITIUM_HALF_LIFE_S) * 6.02214076e23 * 1000) / TRITIUM_MOLAR_G;
const TRITIUM_MEAN_BETA_J = 5.69e3 * 1.602176634e-19;

export const FLUID_LIBRARY: readonly FluidRecord[] = Object.freeze([
  {
    id: "water",
    name: "Water",
    formula: "H₂O",
    summary: "Coolant, steam-cycle working fluid and shielding.",
    molarMass: q(18.015, "g/mol", "iapws", "handbook"),
    states: [
      {
        label: "20 °C, 1 atm",
        pressure: q(101325, "Pa", "iapws", "handbook"),
        temperature: q(C(20), "K", "iapws", "handbook"),
        density: q(998.21, "kg/m³", "iapws", "handbook"),
        specificHeat: q(4182, "J/(kg·K)", "iapws", "handbook"),
        conductivity: q(0.598, "W/(m·K)", "iapws", "handbook"),
        viscosity: q(1.002e-3, "Pa·s", "iapws", "handbook"),
      },
      {
        label: "PWR primary: 15.5 MPa, 300 °C",
        pressure: q(15.5e6, "Pa", "iapws", "handbook"),
        temperature: q(C(300), "K", "iapws", "handbook"),
        density: q(725.5, "kg/m³", "iapws", "handbook", { note: "Rounded." }),
        specificHeat: q(5475, "J/(kg·K)", "iapws", "handbook", { note: "Rounded." }),
        viscosity: q(9.0e-5, "Pa·s", "iapws", "handbook", { note: "Rounded." }),
      },
    ],
    normalBoilingPoint: q(373.124, "K", "iapws", "handbook"),
    triplePoint: q(273.16, "K", "iapws", "handbook"),
    criticalTemperature: q(647.096, "K", "iapws", "handbook"),
    criticalPressure: q(22.064e6, "Pa", "iapws", "handbook"),
    latentHeatOfVaporization: q(2.2564e6, "J/kg", "iapws", "handbook", { at: "100 °C" }),
    release: "steam",
    combustible: false,
    notes: [
      "At 15.5 MPa water boils at 344.8 °C (617.9 K); a PWR keeps its primary subcooled below that.",
      "Pressurised water escaping to atmosphere partly flashes to steam: the visible white plume is condensed droplets, the steam itself is invisible.",
    ],
    sourceSummary: "IAPWS-95 / IF97 properties.",
  },
  {
    id: "helium",
    name: "Helium",
    formula: "He",
    summary: "Gas coolant for hot blankets and the cryogen of superconducting magnets.",
    molarMass: q(4.0026, "g/mol", "nist-webbook", "handbook"),
    states: [
      {
        label: "DEMO blanket coolant: 8 MPa, 400 °C",
        pressure: q(8e6, "Pa", "derived", "handbook"),
        temperature: q(C(400), "K", "derived", "handbook"),
        density: q(5.72, "kg/m³", "derived", "approximate", {
          note: "Ideal gas: ρ = pM / RT = 8e6 × 0.0040026 / (8.314 × 673.15).",
        }),
        specificHeat: q(5193, "J/(kg·K)", "derived", "handbook", {
          note: "Monatomic ideal gas, 5/2 R / M.",
        }),
        viscosity: q(3.5e-5, "Pa·s", "nist-webbook", "approximate", { at: "≈ 673 K" }),
      },
      {
        label: "Saturated liquid at 1 atm",
        pressure: q(101325, "Pa", "nist-webbook", "handbook"),
        temperature: q(4.222, "K", "nist-webbook", "handbook"),
        density: q(125, "kg/m³", "nist-webbook", "handbook"),
      },
    ],
    normalBoilingPoint: q(4.222, "K", "nist-webbook", "handbook"),
    criticalTemperature: q(5.1953, "K", "nist-webbook", "handbook"),
    criticalPressure: q(0.22746e6, "Pa", "nist-webbook", "handbook"),
    latentHeatOfVaporization: q(20.7e3, "J/kg", "derived", "handbook", {
      at: "4.222 K",
      note: "0.0829 kJ/mol ÷ 4.0026 g/mol.",
    }),
    release: "cryogenic-vapor",
    combustible: false,
    notes: [
      "Liquid helium boiling to room-temperature gas expands about 750-fold (125 kg/m³ to 0.166 kg/m³ at 20 °C, 1 atm): a magnet quench vents it violently through relief lines.",
      "Cold helium vapour is denser than air and condenses atmospheric moisture into a white fog that falls before the warming gas rises.",
      "Helium is inert and colourless; in a closed room it displaces oxygen.",
    ],
    sourceSummary: "NIST helium-4 thermophysical properties; ideal-gas derivations.",
  },
  {
    id: "deuterium",
    name: "Deuterium",
    formula: "D₂",
    summary: "Fusion fuel, stable isotope of hydrogen.",
    molarMass: q(4.0282, "g/mol", "nist-webbook", "handbook"),
    states: [],
    triplePoint: q(18.724, "K", "nist-webbook", "handbook", { note: "Normal deuterium." }),
    criticalTemperature: q(38.34, "K", "nist-webbook", "handbook"),
    criticalPressure: q(1.665e6, "Pa", "nist-webbook", "handbook"),
    release: "invisible-gas",
    combustible: {
      note: "A flammable gas like hydrogen, from about 4 % by volume in air.",
    },
    notes: [
      "In a vacuum vessel there is no oxygen: fuel does not burn, it fuses or is pumped away.",
    ],
    sourceSummary: "NIST fundamental equation of state for deuterium (Richardson et al.).",
  },
  {
    id: "tritium",
    name: "Tritium",
    formula: "T₂",
    summary: "Radioactive fusion fuel, bred from lithium in the blanket.",
    molarMass: q(TRITIUM_MOLAR_G * 2, "g/mol", "crc", "handbook"),
    states: [],
    release: "invisible-gas",
    combustible: { note: "Flammable like hydrogen." },
    radioactive: {
      halfLife: q(TRITIUM_HALF_LIFE_S, "s", "nubase-2020", "handbook", { note: "12.32 years." }),
      specificActivity: q(TRITIUM_ACTIVITY_BQ_PER_KG, "Bq/kg", "derived", "handbook", {
        note: "λ N_A / M with λ = ln 2 / T½ (≈ 3.6 × 10¹⁴ Bq per gram).",
      }),
      decayHeat: q(
        TRITIUM_ACTIVITY_BQ_PER_KG * TRITIUM_MEAN_BETA_J,
        "W/kg",
        "derived",
        "handbook",
        {
          note: "Specific activity × mean beta energy 5.69 keV (≈ 0.32 W per gram).",
        },
      ),
    },
    notes: [
      "A weak beta emitter: the electrons do not penetrate skin, but tritium taken into the body (as tritiated water) is a radiological hazard.",
      "Its decay heat warms stored tritium measurably, a few tenths of a watt per gram.",
    ],
    sourceSummary: "NUBASE2020 half-life; activity and decay heat derived.",
  },
  {
    id: "dt-fuel",
    name: "D-T fuel mixture",
    formula: "D + T (50:50)",
    summary: "The fuel of every power-plant tokamak design.",
    states: [],
    specificEnergy: q(
      (17.59e6 * 1.602176634e-19) / ((2.014 + 3.016) * 1.66053907e-27),
      "J/kg",
      "derived",
      "handbook",
      {
        note: "17.59 MeV per reaction ÷ (2.014 + 3.016) u of fuel consumed (fusion-physics energetics).",
      },
    ),
    release: "invisible-gas",
    combustible: false,
    notes: [
      "D + T → ⁴He (3.52 MeV) + n (14.07 MeV), 17.59 MeV per reaction: about 3.4 × 10¹⁴ J per kilogram of fuel burned.",
      "A tokamak holds about a gram of fuel in the plasma at any moment; a fault extinguishes it rather than releasing its fusion energy.",
    ],
    sourceSummary: "Standard reaction energetics.",
  },
  {
    id: "lithium-lead",
    name: "Lithium-lead eutectic",
    formula: "Li₁₇Pb₈₃",
    summary: "Liquid-metal breeder and coolant for tritium-breeding blankets.",
    states: [
      {
        label: "Blanket conditions, 500 °C",
        pressure: q(101325, "Pa", "derived", "approximate"),
        temperature: q(C(500), "K", "derived", "handbook"),
        density: q(10520.35 - 1.19051 * C(500), "kg/m³", "mas-de-les-valls-2008", "approximate", {
          note: "ρ = 10520.35 − 1.19051·T (K).",
        }),
      },
    ],
    meltingPoint: q(C(235), "K", "mas-de-les-valls-2008", "approximate", {
      note: "Recent assessments place the eutectic nearer 15.7 at.% Li; the melting point is about 235 °C either way.",
    }),
    release: "liquid-metal",
    combustible: false,
    notes: [
      "Breeds tritium by ⁶Li + n → T + ⁴He (4.78 MeV); the lead multiplies neutrons and shields.",
      "Electrically conducting: flowing across a strong magnetic field it suffers large MHD pressure drops (not modelled).",
    ],
    sourceSummary: "Mas de les Valls et al. (2008) database.",
  },
  {
    id: "mineral-oil",
    name: "Transformer oil",
    formula: "Mineral insulating oil",
    summary: "Insulating coolant in power transformers — the fire load of a switchyard.",
    states: [
      {
        label: "20 °C",
        pressure: q(101325, "Pa", "iec-60296", "specified"),
        temperature: q(C(20), "K", "iec-60296", "specified"),
        density: q(880, "kg/m³", "iec-60296", "approximate", {
          range: [830, 895],
          note: "IEC 60296 sets a maximum of 895 kg/m³ at 20 °C; typical oils are 860–890.",
        }),
      },
    ],
    release: "liquid-spray",
    combustible: {
      flashPoint: q(C(135), "K", "iec-60296", "specified", { note: "Minimum flash point." }),
      note: "Burns once heated past its flash point and ignited — the fire load of a transformer.",
    },
    notes: [
      "An internal arc in an oil-filled transformer decomposes the oil into gas, pressurising the tank; tank rupture and oil fire are the classic transformer failure.",
    ],
    sourceSummary: "IEC 60296 limits.",
  },
]);
