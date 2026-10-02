import type { Confidence, Curve, MaterialRecord, Quantity } from "./schema.js";

/**
 * ForgeLab's material library.
 *
 * READ docs/material-sources.md BEFORE CHANGING ANY NUMBER HERE.
 *
 * Every value is a conventional handbook, standard or datasheet figure for the named
 * grade, with its source and confidence. Nothing is tuned for gameplay; nothing missing
 * is filled in. A property group that a material lacks is unknown.
 *
 * The first five records are the original structural catalogue and keep their exact
 * values: simulation results must not move when the library grows.
 */

const C = (celsius: number) => celsius + 273.15;

function q(
  value: number,
  unit: string,
  source: string,
  confidence: Confidence,
  extra: { at?: string; range?: readonly [number, number]; note?: string } = {},
): Quantity {
  return { value, unit, source, confidence, ...extra };
}

const MPa = (v: number, source: string, confidence: Confidence, extra = {}) =>
  q(v * 1e6, "Pa", source, confidence, extra);
const GPa = (v: number, source: string, confidence: Confidence, extra = {}) =>
  q(v * 1e9, "Pa", source, confidence, extra);

/** EN 1993-1-2 Table 3.1: carbon-steel reduction factors at elevated temperature. */
const EN1993_KY: Curve = {
  unit: "",
  source: "en1993-1-2",
  confidence: "specified",
  points: [
    [C(20), 1],
    [C(400), 1],
    [C(500), 0.78],
    [C(600), 0.47],
    [C(700), 0.23],
    [C(800), 0.11],
    [C(900), 0.06],
    [C(1000), 0.04],
    [C(1100), 0.02],
    [C(1200), 0],
  ],
  note: "Effective yield strength ky,θ for carbon steels (S235–S460) in structural fire design. Applies to the A36 and A572 grades here, not to stainless steels.",
};

const EN1993_KE: Curve = {
  unit: "",
  source: "en1993-1-2",
  confidence: "specified",
  points: [
    [C(20), 1],
    [C(100), 1],
    [C(200), 0.9],
    [C(300), 0.8],
    [C(400), 0.7],
    [C(500), 0.6],
    [C(600), 0.31],
    [C(700), 0.13],
    [C(800), 0.09],
    [C(900), 0.0675],
    [C(1000), 0.045],
    [C(1100), 0.0225],
    [C(1200), 0],
  ],
  note: "Slope of the linear elastic range kE,θ for carbon steels.",
};

/** CRC: resistivity of pure copper, 10⁻⁸ Ω·m → Ω·m. */
const COPPER_RESISTIVITY: Curve = {
  unit: "Ω·m",
  source: "crc",
  confidence: "handbook",
  points: (
    [
      [100, 0.348],
      [200, 1.046],
      [273, 1.543],
      [293, 1.678],
      [300, 1.725],
      [400, 2.402],
      [500, 3.09],
      [600, 3.792],
      [700, 4.514],
      [800, 5.262],
      [900, 6.041],
    ] as const
  ).map(([t, r]) => [t, r * 1e-8] as const),
  note: "Pure annealed copper. Below ~100 K the value depends on purity (residual resistance ratio) and is not tabulated here; above 900 K it is held at the 900 K value, which understates it.",
};

const IRON_CURIE = q(1043, "K", "crc", "handbook", {
  note: "Curie point of iron (770 °C); carbon and low-alloy steels are ferromagnetic below it.",
});

export const MATERIAL_LIBRARY: readonly MaterialRecord[] = Object.freeze([
  /* ---------------------------------------------------------------------------------- *
   * Original structural catalogue (values unchanged)
   * ---------------------------------------------------------------------------------- */
  {
    id: "structural-steel",
    name: "Structural Steel",
    grade: "ASTM A36 hot-rolled carbon steel",
    category: "structural-metal",
    summary: "The default carbon steel for frames, supports and plant structure.",
    density: q(7850, "kg/m³", "crc", "handbook", { note: "Conventional carbon-steel density." }),
    mechanical: {
      yieldStrength: MPa(250, "astm-a36", "specified", {
        note: "Specified minimum for thickness ≤ 200 mm; real stock usually tests higher.",
      }),
      ultimateStrength: MPa(400, "astm-a36", "specified", {
        range: [400e6, 550e6],
        note: "Specified tensile range 400–550 MPa.",
      }),
      youngsModulus: GPa(200, "en1993-1-1", "specified"),
      poissonsRatio: q(0.3, "", "en1993-1-1", "specified"),
      yieldReduction: EN1993_KY,
      modulusReduction: EN1993_KE,
    },
    thermal: {
      specificHeat: q(486, "J/(kg·K)", "crc", "handbook", { at: "20–100 °C" }),
      conductivity: q(45, "W/(m·K)", "crc", "handbook", { at: "near room temperature" }),
      expansion: q(12e-6, "1/K", "en1993-1-1", "specified"),
      melting: q(C(1425), "K", "asm-datasheet", "approximate", {
        range: [C(1425), C(1540)],
        note: "Melting range of carbon steels; composition-dependent.",
      }),
      maxService: q(C(400), "K", "en1993-1-2", "specified", {
        note: "EN 1993-1-2 applies no reduction to effective yield strength up to 400 °C.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(1.6e-7, "Ω·m", "crc", "approximate", {
        range: [1.4e-7, 1.8e-7],
        at: "20 °C",
      }),
    },
    magnetic: { ferromagnetic: true, curieTemperature: IRON_CURIE },
    presentation: {
      color: "#7b8590",
      metalness: 0.6,
      roughness: 0.55,
      thermalResponse: "steel",
      combustible: false,
    },
    sourceSummary: "ASTM A36/A36M specified minimum yield; handbook values for the rest.",
    notes: [
      "250 MPa is the ASTM A36 specified *minimum* yield strength for thicknesses up to 200 mm; real stock typically tests higher.",
      "400 degC is the temperature up to which EN 1993-1-2 applies no reduction to effective yield strength; above it carbon steel loses strength rapidly.",
      "Electrical resistivity for low-carbon steels spans roughly 1.4e-7 to 1.8e-7 ohm-m depending on carbon and alloy content.",
    ],
  },
  {
    id: "stainless-steel",
    name: "Stainless Steel",
    grade: "AISI 316L austenitic stainless, annealed",
    category: "structural-metal",
    summary: "Vacuum vessels, cryostats, coil cases and pressure parts.",
    density: q(8000, "kg/m³", "supplier-datasheet", "typical"),
    mechanical: {
      yieldStrength: MPa(170, "astm-a240", "specified", {
        note: "Minimum 0.2 % proof stress, annealed 316L.",
      }),
      ultimateStrength: MPa(485, "astm-a240", "specified"),
      youngsModulus: GPa(193, "supplier-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(500, "J/(kg·K)", "supplier-datasheet", "typical", { at: "0–100 °C" }),
      conductivity: q(16.3, "W/(m·K)", "supplier-datasheet", "typical", {
        at: "100 °C",
        note: "Nearer 14.6 W/(m·K) at 20 °C.",
      }),
      expansion: q(16e-6, "1/K", "supplier-datasheet", "typical", { at: "0–100 °C" }),
      melting: q(C(1375), "K", "supplier-datasheet", "typical", {
        range: [C(1375), C(1400)],
      }),
      maxService: q(C(870), "K", "supplier-datasheet", "typical", {
        note: "Intermittent-service scaling limit in air.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(7.4e-7, "Ω·m", "supplier-datasheet", "typical"),
    },
    magnetic: {
      ferromagnetic: false,
      note: "Austenitic: essentially non-magnetic when annealed; cold work and welds can raise the permeability slightly.",
    },
    presentation: {
      color: "#a1a9b2",
      metalness: 0.75,
      roughness: 0.35,
      thermalResponse: "steel",
      combustible: false,
    },
    sourceSummary: "ASTM A240 specified minimum 0.2% proof stress; supplier datasheet physicals.",
    notes: [
      "170 MPa is the ASTM A240 minimum 0.2% proof stress for annealed 316L. Non-low-carbon 316 is specified at 205 MPa - do not substitute one for the other.",
      "870 degC is the intermittent-service scaling limit in air; continuous service in air is usually quoted as 925 degC. The lower figure is used here because thermal cycling is the harsher case.",
      "Pressure-retaining design codes allow far lower temperatures than the scaling limit because of creep. ForgeLab does not model creep.",
      "Thermal conductivity is quoted at 100 degC; at 20 degC it is nearer 14.6 W/(m*K).",
    ],
  },
  {
    id: "tungsten",
    name: "Tungsten",
    grade: "Pure sintered tungsten (>= 99.95%), stress-relieved",
    category: "plasma-facing",
    summary: "Divertor and first-wall armour: the highest melting point of any metal.",
    density: q(19250, "kg/m³", "crc", "handbook"),
    mechanical: {
      yieldStrength: MPa(550, "supplier-datasheet", "approximate", {
        range: [550e6, 1500e6],
        note: "Conservative for sintered stock; worked rod and wire are far stronger.",
      }),
      youngsModulus: GPa(411, "crc", "handbook"),
    },
    thermal: {
      specificHeat: q(132, "J/(kg·K)", "crc", "handbook", {
        note: "24.27 J/(mol·K) ÷ 183.84 g/mol.",
      }),
      conductivity: q(173, "W/(m·K)", "crc", "handbook", { at: "300 K" }),
      expansion: q(4.5e-6, "1/K", "crc", "handbook", { at: "25 °C" }),
      melting: q(3695, "K", "crc", "handbook", { note: "3422 °C." }),
      maxService: q(C(1300), "K", "supplier-datasheet", "approximate", {
        note: "Approximate recrystallisation onset, above which tungsten embrittles. Assumes vacuum.",
      }),
      minService: q(C(400), "K", "supplier-datasheet", "approximate", {
        range: [C(200), C(400)],
        note: "Ductile-to-brittle transition of unirradiated tungsten; below it tungsten fractures with little warning.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(5.6e-8, "Ω·m", "crc", "handbook", { at: "20 °C" }),
    },
    magnetic: { ferromagnetic: false },
    plasmaFacing: {
      source: "crc",
      notes: [
        "Highest melting point of any metal and low erosion by hydrogen-isotope sputtering, which is why ITER's divertor is tungsten.",
        "High atomic number: tungsten eroded into the plasma radiates strongly, so very little is tolerated.",
      ],
    },
    presentation: {
      color: "#565b62",
      metalness: 0.7,
      roughness: 0.45,
      thermalResponse: "refractory",
      combustible: false,
    },
    sourceSummary: "CRC Handbook physicals; supplier datasheet mechanicals for sintered rod.",
    notes: [
      "Tungsten yield strength is extremely process-dependent: 550 MPa is a conservative figure for sintered stress-relieved stock, while heavily worked wire and rod are quoted from 750 MPa to well over 1500 MPa.",
      "1300 degC is the approximate recrystallization onset for pure tungsten, above which it embrittles. It is NOT the melting point (3422 degC).",
      "In air, oxidation limits tungsten to a few hundred degC. The figure above assumes vacuum or inert atmosphere, which ForgeLab does not model yet.",
    ],
  },
  {
    id: "copper",
    name: "Copper",
    grade: "C11000 electrolytic tough pitch, annealed (O60)",
    category: "conductor",
    summary: "Busbars, resistive coils and the stabiliser of superconducting cable.",
    density: q(8960, "kg/m³", "crc", "handbook"),
    mechanical: {
      yieldStrength: MPa(69, "asm-datasheet", "typical", {
        note: "Annealed temper; cold-worked H04 reaches ~310 MPa.",
      }),
      ultimateStrength: MPa(220, "asm-datasheet", "typical"),
      youngsModulus: GPa(117, "asm-datasheet", "typical", { range: [110e9, 128e9] }),
    },
    thermal: {
      specificHeat: q(385, "J/(kg·K)", "crc", "handbook"),
      conductivity: q(401, "W/(m·K)", "crc", "handbook", { at: "300 K" }),
      expansion: q(16.5e-6, "1/K", "crc", "handbook", { at: "25 °C" }),
      melting: q(1357.77, "K", "crc", "handbook", { note: "1084.62 °C." }),
      maxService: q(C(200), "K", "asm-datasheet", "typical", {
        note: "Softening/annealing limit, not a melting or oxidation limit.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(1.678e-8, "Ω·m", "crc", "handbook", { at: "20 °C" }),
      resistivityCurve: COPPER_RESISTIVITY,
    },
    magnetic: { ferromagnetic: false },
    presentation: {
      color: "#a87458",
      metalness: 0.9,
      roughness: 0.35,
      thermalResponse: "copper",
      combustible: false,
    },
    sourceSummary:
      "CRC Handbook physicals for pure Cu at 20 degC; datasheet mechanicals for C11000-O60.",
    notes: [
      "69 MPa is annealed temper. Cold-worked C11000 (H04) reaches roughly 310 MPa - temper matters more than grade for copper.",
      "200 degC is a softening/annealing service limit for cold-worked copper, not a melting or oxidation limit.",
      "1.678e-8 ohm-m corresponds to about 103% IACS; the IACS reference standard itself is 1.7241e-8 ohm-m.",
      "Resistivity rises about 0.4 % per kelvin near room temperature: a hot busbar dissipates more, which heats it further.",
    ],
  },
  {
    id: "aluminum",
    name: "Aluminum",
    grade: "6061-T6 aluminium alloy",
    category: "structural-metal",
    summary: "Light frames and housings.",
    density: q(2700, "kg/m³", "asm-datasheet", "typical"),
    mechanical: {
      yieldStrength: MPa(276, "asm-datasheet", "typical"),
      ultimateStrength: MPa(310, "asm-datasheet", "typical"),
      youngsModulus: GPa(68.9, "asm-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(896, "J/(kg·K)", "asm-datasheet", "typical"),
      conductivity: q(167, "W/(m·K)", "asm-datasheet", "typical"),
      expansion: q(23.6e-6, "1/K", "asm-datasheet", "typical", { at: "20–100 °C" }),
      melting: q(C(582), "K", "asm-datasheet", "typical", {
        range: [C(582), C(652)],
        note: "Solidus 582 °C, liquidus 652 °C — it melts before it visibly glows.",
      }),
      maxService: q(C(200), "K", "asm-datasheet", "typical", {
        note: "Over-ageing limit: the T6 temper degrades permanently above it.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(3.99e-8, "Ω·m", "asm-datasheet", "typical"),
    },
    magnetic: { ferromagnetic: false },
    presentation: {
      color: "#bcc2c9",
      metalness: 0.8,
      roughness: 0.4,
      thermalResponse: "light-alloy",
      combustible: false,
    },
    sourceSummary: "ASM/supplier datasheet values for 6061-T6.",
    notes: [
      "276 MPa (40 ksi) is the typical 6061-T6 0.2% proof stress. The T4 temper of the same alloy is around 145 MPa.",
      "200 degC is an over-ageing limit: held above it, T6 temper degrades permanently and does not recover on cooling.",
    ],
  },

  /* ---------------------------------------------------------------------------------- *
   * Structural / engineering metals
   * ---------------------------------------------------------------------------------- */
  {
    id: "stainless-304l",
    name: "Stainless Steel 304L",
    grade: "AISI 304L austenitic stainless, annealed",
    category: "structural-metal",
    summary: "General-purpose austenitic stainless for ducts, frames and enclosures.",
    density: q(8000, "kg/m³", "supplier-datasheet", "typical", { range: [7900, 8000] }),
    mechanical: {
      yieldStrength: MPa(170, "astm-a240", "specified"),
      ultimateStrength: MPa(485, "astm-a240", "specified"),
      youngsModulus: GPa(193, "supplier-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(500, "J/(kg·K)", "supplier-datasheet", "typical", { at: "0–100 °C" }),
      conductivity: q(16.2, "W/(m·K)", "supplier-datasheet", "typical", { at: "100 °C" }),
      expansion: q(17.2e-6, "1/K", "supplier-datasheet", "typical", { at: "0–100 °C" }),
      melting: q(C(1400), "K", "supplier-datasheet", "typical", {
        range: [C(1400), C(1450)],
      }),
      maxService: q(C(870), "K", "supplier-datasheet", "typical", {
        note: "Intermittent-service scaling limit in air (925 °C continuous).",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(7.2e-7, "Ω·m", "supplier-datasheet", "typical"),
    },
    magnetic: { ferromagnetic: false, note: "Austenitic; slightly magnetic after cold work." },
    presentation: {
      color: "#a7aeb6",
      metalness: 0.75,
      roughness: 0.35,
      thermalResponse: "steel",
      combustible: false,
    },
    sourceSummary: "ASTM A240 minimums; supplier datasheet physicals.",
    notes: [
      "Same specified minimum proof stress as 316L (170 MPa); 316L's molybdenum buys corrosion resistance, not strength.",
      "Like 316L, creep — not modelled — limits pressure parts far below the scaling temperature.",
    ],
  },
  {
    id: "hsla-steel",
    name: "High-Strength Steel",
    grade: "ASTM A572 Grade 50 high-strength low-alloy steel",
    category: "structural-metal",
    summary: "Heavier-duty frames and supports: 38 % more yield than A36 for the same weight.",
    density: q(7850, "kg/m³", "crc", "handbook"),
    mechanical: {
      yieldStrength: MPa(345, "astm-a572", "specified", { note: "Specified minimum (50 ksi)." }),
      ultimateStrength: MPa(450, "astm-a572", "specified"),
      youngsModulus: GPa(200, "en1993-1-1", "specified"),
      poissonsRatio: q(0.3, "", "en1993-1-1", "specified"),
      yieldReduction: EN1993_KY,
      modulusReduction: EN1993_KE,
    },
    thermal: {
      specificHeat: q(486, "J/(kg·K)", "crc", "handbook", { at: "20–100 °C" }),
      conductivity: q(45, "W/(m·K)", "crc", "approximate", {
        note: "Carbon-steel handbook value; low-alloy additions change it by a few percent.",
      }),
      expansion: q(12e-6, "1/K", "en1993-1-1", "specified"),
      melting: q(C(1425), "K", "asm-datasheet", "approximate", {
        range: [C(1425), C(1540)],
      }),
      maxService: q(C(400), "K", "en1993-1-2", "specified", {
        note: "EN 1993-1-2's reduction factors are the same for S235–S460 carbon steels.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(1.6e-7, "Ω·m", "crc", "approximate", { range: [1.4e-7, 1.9e-7] }),
    },
    magnetic: { ferromagnetic: true, curieTemperature: IRON_CURIE },
    presentation: {
      color: "#6f7983",
      metalness: 0.6,
      roughness: 0.55,
      thermalResponse: "steel",
      combustible: false,
    },
    sourceSummary: "ASTM A572 Grade 50 specified minimums; carbon-steel handbook physicals.",
    notes: [
      "Physical properties are those of carbon steel; only the strength differs from A36.",
      "Loses strength with temperature exactly as A36 does (EN 1993-1-2), so a hot A572 column is no safer in proportion.",
    ],
  },
  {
    id: "eurofer97",
    name: "EUROFER97",
    grade: "EUROFER97 reduced-activation ferritic-martensitic steel, normalised and tempered",
    category: "nuclear",
    summary: "The European reference structural steel for breeding blankets.",
    density: q(7750, "kg/m³", "rieth-2003", "approximate", { range: [7740, 7800] }),
    mechanical: {
      yieldStrength: MPa(530, "rieth-2003", "approximate", {
        range: [500e6, 550e6],
        at: "room temperature",
        note: "Unirradiated, as-received plate. Neutron irradiation hardens and embrittles it.",
      }),
      youngsModulus: GPa(217, "rieth-2003", "approximate", { at: "room temperature" }),
    },
    thermal: {
      maxService: q(C(550), "K", "rieth-2003", "approximate", {
        note: "Upper end of the design temperature range, set by creep strength.",
      }),
      minService: q(C(350), "K", "rieth-2003", "approximate", {
        note: "Below ~350 °C, irradiation raises the ductile-to-brittle transition sharply.",
      }),
    },
    magnetic: {
      ferromagnetic: true,
      note: "Ferromagnetic — it distorts a tokamak's field, which designs must allow for.",
    },
    nuclear: {
      role: ["structural"],
      source: "rieth-2003",
      notes: [
        "Reduced activation: molybdenum, niobium and nickel are replaced by tungsten, tantalum and vanadium so that activated material decays to recyclable levels in decades rather than millennia.",
      ],
    },
    presentation: {
      color: "#6c747c",
      metalness: 0.6,
      roughness: 0.5,
      thermalResponse: "steel",
      combustible: false,
    },
    sourceSummary: "FZKA 6911 (Rieth et al. 2003), room-temperature unirradiated properties.",
    notes: [
      "Reference data only: thermal and electrical properties are not catalogued yet, so it cannot be assigned to a placed part.",
      "Values are for unirradiated material; irradiation changes strength and ductility substantially.",
    ],
  },
  {
    id: "aluminum-7075",
    name: "Aluminum 7075",
    grade: "7075-T6 aluminium alloy",
    category: "structural-metal",
    summary: "High-strength aluminium for light structures that stay cool.",
    density: q(2810, "kg/m³", "asm-datasheet", "typical"),
    mechanical: {
      yieldStrength: MPa(503, "asm-datasheet", "typical"),
      ultimateStrength: MPa(572, "asm-datasheet", "typical"),
      youngsModulus: GPa(71.7, "asm-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(960, "J/(kg·K)", "asm-datasheet", "typical"),
      conductivity: q(130, "W/(m·K)", "asm-datasheet", "typical"),
      expansion: q(23.6e-6, "1/K", "asm-datasheet", "typical", { at: "20–100 °C" }),
      melting: q(C(477), "K", "asm-datasheet", "typical", {
        range: [C(477), C(635)],
        note: "Solidus 477 °C, liquidus 635 °C.",
      }),
      maxService: q(C(120), "K", "derived", "approximate", {
        note: "The T6 artificial-ageing temperature (≈121 °C); held above it the temper over-ages and strength falls permanently.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(5.15e-8, "Ω·m", "asm-datasheet", "typical", { note: "≈ 33 % IACS." }),
    },
    magnetic: { ferromagnetic: false },
    presentation: {
      color: "#b6bcc4",
      metalness: 0.8,
      roughness: 0.38,
      thermalResponse: "light-alloy",
      combustible: false,
    },
    sourceSummary: "ASM datasheet typical values for 7075-T6.",
    notes: [
      "Nearly twice 6061-T6's yield strength, but it gives up that strength at a lower temperature.",
      "Not weldable by ordinary fusion welding; the sandbox does not model joining.",
    ],
  },
  {
    id: "titanium-6al4v",
    name: "Titanium Ti-6Al-4V",
    grade: "Ti-6Al-4V (Grade 5), annealed",
    category: "structural-metal",
    summary: "Strong, light and a poor conductor of heat: supports that must not carry heat.",
    density: q(4430, "kg/m³", "asm-datasheet", "typical"),
    mechanical: {
      yieldStrength: MPa(880, "asm-datasheet", "typical", {
        note: "Typical annealed; ASTM B265 specifies 828 MPa minimum.",
        range: [828e6, 950e6],
      }),
      ultimateStrength: MPa(950, "asm-datasheet", "typical"),
      youngsModulus: GPa(113.8, "asm-datasheet", "typical"),
      poissonsRatio: q(0.342, "", "asm-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(526, "J/(kg·K)", "asm-datasheet", "typical"),
      conductivity: q(6.7, "W/(m·K)", "asm-datasheet", "typical"),
      expansion: q(8.6e-6, "1/K", "asm-datasheet", "typical", { at: "20–100 °C" }),
      melting: q(C(1604), "K", "asm-datasheet", "typical", { range: [C(1604), C(1660)] }),
      maxService: q(C(400), "K", "asm-datasheet", "approximate", {
        note: "Commonly quoted maximum service temperature for strength retention.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(1.78e-6, "Ω·m", "asm-datasheet", "typical"),
    },
    magnetic: { ferromagnetic: false },
    presentation: {
      color: "#8d8f93",
      metalness: 0.7,
      roughness: 0.42,
      thermalResponse: "steel",
      combustible: false,
    },
    sourceSummary: "ASM datasheet typical values for annealed Grade 5; ASTM B265 minimum.",
    notes: [
      "Thermal conductivity is a fortieth of copper's: good for supports between cold and warm parts.",
      "Titanium shows oxide temper colours (straw to blue) when heated in air, like steel.",
    ],
  },

  /* ---------------------------------------------------------------------------------- *
   * Conductors
   * ---------------------------------------------------------------------------------- */
  {
    id: "copper-ofhc",
    name: "Copper OFHC",
    grade: "C10100 oxygen-free electronic copper, annealed",
    category: "conductor",
    summary: "Superconducting-cable stabiliser and high-purity conductors.",
    density: q(8940, "kg/m³", "asm-datasheet", "typical"),
    mechanical: {
      yieldStrength: MPa(69, "asm-datasheet", "typical", { note: "Annealed." }),
      ultimateStrength: MPa(221, "asm-datasheet", "typical"),
      youngsModulus: GPa(115, "asm-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(385, "J/(kg·K)", "crc", "handbook"),
      conductivity: q(391, "W/(m·K)", "asm-datasheet", "typical", { at: "20 °C" }),
      expansion: q(17e-6, "1/K", "asm-datasheet", "typical", { at: "20–100 °C" }),
      melting: q(1357.77, "K", "crc", "handbook"),
      maxService: q(C(200), "K", "asm-datasheet", "typical", {
        note: "Softening limit for worked tempers.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(1.7071e-8, "Ω·m", "astm-b170", "specified", {
        note: "101 % IACS minimum: 1.7241e-8 ÷ 1.01.",
      }),
      resistivityCurve: COPPER_RESISTIVITY,
    },
    magnetic: { ferromagnetic: false },
    presentation: {
      color: "#b07a5c",
      metalness: 0.9,
      roughness: 0.3,
      thermalResponse: "copper",
      combustible: false,
    },
    sourceSummary: "ASTM B170 minimum conductivity; ASM datasheet typical values.",
    notes: [
      "Its value in a magnet is at 4 K, where purity sets the resistivity (the residual resistance ratio, typically 100–300 for OFHC). That low-temperature resistivity is grade- and strain-dependent and not catalogued.",
    ],
  },
  {
    id: "aluminum-1350",
    name: "Aluminum 1350 conductor",
    grade: "1350-H19 electrical-conductor aluminium",
    category: "conductor",
    summary: "Overhead-line and busbar aluminium: half copper's conductivity at a third the mass.",
    density: q(2705, "kg/m³", "asm-datasheet", "typical"),
    mechanical: {
      youngsModulus: GPa(69, "asm-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(900, "J/(kg·K)", "asm-datasheet", "typical"),
      conductivity: q(234, "W/(m·K)", "asm-datasheet", "typical"),
      melting: q(C(646), "K", "asm-datasheet", "typical", { range: [C(646), C(657)] }),
    },
    electrical: {
      insulator: false,
      resistivity: q(2.8264e-8, "Ω·m", "astm-b230", "specified", {
        note: "61.0 % IACS minimum: 1.7241e-8 ÷ 0.610.",
      }),
    },
    magnetic: { ferromagnetic: false },
    presentation: {
      color: "#c4c9cf",
      metalness: 0.8,
      roughness: 0.4,
      thermalResponse: "light-alloy",
      combustible: false,
    },
    sourceSummary: "ASTM B230 minimum conductivity; ASM typical physicals.",
    notes: [
      "Reference data only: its yield strength depends strongly on wire temper and is not catalogued, so it cannot be assigned to a load-bearing part.",
    ],
  },

  /* ---------------------------------------------------------------------------------- *
   * Plasma-facing and high-temperature
   * ---------------------------------------------------------------------------------- */
  {
    id: "molybdenum",
    name: "Molybdenum",
    grade: "Pure molybdenum (≥ 99.95 %), stress-relieved",
    category: "plasma-facing",
    summary: "Refractory metal for hot structures and limiters.",
    density: q(10280, "kg/m³", "crc", "handbook"),
    mechanical: {
      yieldStrength: MPa(550, "supplier-datasheet", "approximate", {
        range: [550e6, 800e6],
        note: "Process-dependent like tungsten; the low end is used.",
      }),
      youngsModulus: GPa(329, "crc", "handbook"),
    },
    thermal: {
      specificHeat: q(251, "J/(kg·K)", "crc", "handbook", {
        note: "24.06 J/(mol·K) ÷ 95.95 g/mol.",
      }),
      conductivity: q(138, "W/(m·K)", "crc", "handbook", { at: "300 K" }),
      expansion: q(4.8e-6, "1/K", "crc", "handbook", { at: "25 °C" }),
      melting: q(2896, "K", "crc", "handbook", { note: "2623 °C." }),
      maxService: q(C(1100), "K", "supplier-datasheet", "approximate", {
        note: "Approximate recrystallisation onset (vacuum); embrittles above it.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(5.34e-8, "Ω·m", "crc", "approximate", {
        at: "20 °C",
        range: [5.3e-8, 5.5e-8],
      }),
    },
    magnetic: { ferromagnetic: false },
    plasmaFacing: {
      source: "crc",
      notes: [
        "High melting point and conductivity; used for limiters and in devices such as Alcator C-Mod.",
        "Like tungsten, high-Z: impurities in the plasma radiate strongly.",
      ],
    },
    presentation: {
      color: "#7d838a",
      metalness: 0.7,
      roughness: 0.4,
      thermalResponse: "refractory",
      combustible: false,
    },
    sourceSummary: "CRC Handbook physicals; supplier datasheet mechanicals.",
    notes: [
      "Oxidises rapidly in air above ~500 °C (volatile MoO3); the service limit assumes vacuum.",
    ],
  },
  {
    id: "beryllium",
    name: "Beryllium",
    grade: "Materion S-65 hot-isostatically-pressed beryllium",
    category: "plasma-facing",
    summary: "Low-Z first-wall armour (JET, ITER) and a blanket neutron multiplier.",
    density: q(1850, "kg/m³", "crc", "handbook", { note: "1.848 g/cm³." }),
    mechanical: {
      yieldStrength: MPa(207, "materion-s65", "specified", { note: "S-65 minimum." }),
      ultimateStrength: MPa(345, "materion-s65", "specified"),
      youngsModulus: GPa(287, "crc", "handbook"),
    },
    thermal: {
      specificHeat: q(1825, "J/(kg·K)", "crc", "handbook"),
      conductivity: q(200, "W/(m·K)", "crc", "handbook", { at: "300 K" }),
      expansion: q(11.3e-6, "1/K", "crc", "handbook", { at: "25 °C" }),
      melting: q(1560, "K", "crc", "handbook", { note: "1287 °C." }),
    },
    magnetic: { ferromagnetic: false },
    nuclear: {
      role: ["multiplier"],
      source: "crc",
      notes: [
        "A neutron multiplier: a fast neutron can knock two out of a beryllium nucleus, which helps a blanket breed more than one triton per fusion neutron.",
        "Beryllium dust is toxic (chronic beryllium disease); handling requires containment.",
      ],
    },
    plasmaFacing: {
      source: "crc",
      notes: [
        "Low atomic number: eroded beryllium radiates little in the plasma, but its melting point is less than half of tungsten's.",
      ],
    },
    presentation: {
      color: "#9ea4aa",
      metalness: 0.65,
      roughness: 0.4,
      thermalResponse: "light-alloy",
      combustible: false,
    },
    sourceSummary: "Materion S-65 minimums; CRC Handbook physicals.",
    notes: [
      "Reference data only: its electrical resistivity and service limit are not catalogued yet, so it cannot be assigned to a placed part.",
    ],
  },
  {
    id: "graphite-ig110",
    name: "Graphite",
    grade: "Toyo Tanso IG-110 isotropic nuclear graphite",
    category: "plasma-facing",
    summary: "Carbon armour tiles and moderator blocks. It does not melt — it sublimes.",
    density: q(1770, "kg/m³", "toyo-tanso-ig110", "typical"),
    mechanical: {
      flexuralStrength: MPa(39, "toyo-tanso-ig110", "typical"),
      compressiveStrength: MPa(78, "toyo-tanso-ig110", "typical"),
      ultimateStrength: MPa(25, "toyo-tanso-ig110", "typical", { note: "Tensile strength." }),
      youngsModulus: GPa(9.8, "toyo-tanso-ig110", "typical"),
    },
    thermal: {
      specificHeat: q(710, "J/(kg·K)", "crc", "handbook", { at: "room temperature" }),
      conductivity: q(120, "W/(m·K)", "toyo-tanso-ig110", "typical"),
      expansion: q(3.9e-6, "1/K", "toyo-tanso-ig110", "typical"),
      decomposition: q(3900, "K", "crc", "approximate", {
        note: "Sublimes at about 3900 K at atmospheric pressure; it has no liquid phase at 1 atm.",
      }),
    },
    electrical: {
      insulator: false,
      resistivity: q(11e-6, "Ω·m", "toyo-tanso-ig110", "typical"),
    },
    magnetic: { ferromagnetic: false },
    plasmaFacing: {
      source: "crc",
      notes: [
        "Cannot melt, so it survives heat pulses that would melt metal armour, but it erodes chemically in hydrogen plasma and traps tritium in the redeposited carbon.",
      ],
    },
    presentation: {
      color: "#3b3d40",
      metalness: 0.1,
      roughness: 0.85,
      thermalResponse: "ceramic",
      combustible: {
        ignition: q(C(400), "K", "crc", "approximate", {
          range: [C(400), C(600)],
          note: "Graphite oxidises in air from roughly 400–600 °C and can sustain burning when hot; it cannot burn in vacuum.",
        }),
        smoke: "light",
      },
    },
    sourceSummary: "Toyo Tanso IG-110 typical properties; CRC Handbook for heat capacity.",
    notes: [
      "Brittle: it fails in tension and bending at a small fraction of a metal's strength.",
      "Reference data only: a brittle material does not fit the structural solver's yield model.",
    ],
  },
  {
    id: "sic-cvd",
    name: "Silicon Carbide",
    grade: "High-purity CVD β-SiC (monolithic)",
    category: "plasma-facing",
    summary: "Low-activation ceramic for hot blanket structures and SiC/SiC composites.",
    density: q(3210, "kg/m³", "cvd-sic-datasheet", "typical"),
    mechanical: {
      flexuralStrength: MPa(470, "cvd-sic-datasheet", "approximate", {
        range: [400e6, 600e6],
      }),
      youngsModulus: GPa(466, "cvd-sic-datasheet", "typical"),
    },
    thermal: {
      specificHeat: q(640, "J/(kg·K)", "cvd-sic-datasheet", "typical"),
      conductivity: q(300, "W/(m·K)", "cvd-sic-datasheet", "approximate", {
        range: [250, 330],
        note: "High-purity CVD grades; irradiation lowers it severalfold.",
      }),
      expansion: q(4e-6, "1/K", "cvd-sic-datasheet", "approximate", {
        at: "20–1000 °C (mean)",
      }),
      decomposition: q(C(2730), "K", "crc", "approximate", {
        note: "Decomposes rather than melting at atmospheric pressure.",
      }),
    },
    magnetic: { ferromagnetic: false },
    nuclear: {
      role: ["structural"],
      source: "cvd-sic-datasheet",
      notes: [
        "Low induced activity; SiC fibre-reinforced SiC composites are a candidate structural material for advanced blankets.",
      ],
    },
    presentation: {
      color: "#4a4e55",
      metalness: 0.2,
      roughness: 0.6,
      thermalResponse: "ceramic",
      combustible: false,
    },
    sourceSummary: "CVD β-SiC producer datasheets (typical).",
    notes: [
      "Brittle ceramic: strength is statistical and flaw-dependent.",
      "Reference data only: brittle fracture is not modelled by the structural solver.",
      "SiC/SiC composites differ substantially from monolithic SiC and are not catalogued yet.",
    ],
  },

  /* ---------------------------------------------------------------------------------- *
   * Superconductors
   * ---------------------------------------------------------------------------------- */
  {
    id: "nbti",
    name: "Niobium–Titanium",
    grade: "Nb-47 wt% Ti superconductor alloy",
    category: "superconductor",
    summary: "The workhorse superconductor (MRI, LHC, ITER poloidal coils) — up to ~10 T at 4 K.",
    density: q(6020, "kg/m³", "derived", "approximate", {
      note: "Ideal-mixture estimate from elemental densities: 1/ρ = 0.53/8.57 + 0.47/4.506 g/cm³.",
    }),
    superconducting: {
      criticalTemperatureZeroField: q(9.2, "K", "bottura-2000", "handbook"),
      upperCriticalFieldZeroTemperature: q(14.5, "T", "bottura-2000", "handbook"),
      temperatureExponent: 1.7,
      criticalSurface: "lubell-bottura",
      note: "Bc2(T) = Bc20(1 − t^1.7) after Lubell (1983). At 5 T Tc ≈ 7.2 K; at 9 T ≈ 5.3 K.",
    },
    presentation: {
      color: "#7b7fa6",
      metalness: 0.6,
      roughness: 0.45,
      thermalResponse: "superconductor",
      combustible: false,
    },
    sourceSummary:
      "Bottura (2000) critical-surface parameters; density derived from elemental densities.",
    notes: [
      "Only the superconducting critical surface and density are catalogued; NbTi is used here as the conductor region of finished magnets, never as a structural member.",
      "The critical temperature falls with field: at 5 T, Tc ≈ 7.2 K; at 9 T, Tc ≈ 5.3 K.",
    ],
  },
  {
    id: "nb3sn",
    name: "Niobium–Tin",
    grade: "Nb₃Sn A15 superconductor (optimal composition, unstrained)",
    category: "superconductor",
    summary: "High-field superconductor (ITER toroidal-field and central-solenoid coils).",
    density: q(8920, "kg/m³", "derived", "approximate", {
      note: "From the A15 cell: 6 Nb + 2 Sn (794.9 g/mol) in a = 5.29 Å.",
    }),
    superconducting: {
      criticalTemperatureZeroField: q(18, "K", "godeke-2006", "approximate", {
        note: "Optimal, unstrained A15; practical wires reach ~16–18 K.",
      }),
      upperCriticalFieldZeroTemperature: q(30, "T", "godeke-2006", "approximate", {
        range: [28, 30],
        note: "Unstrained; compressive strain in a cable lowers it by several tesla.",
      }),
      temperatureExponent: 1.52,
      criticalSurface: "godeke",
      note: "Bc2(T) = Bc2(0)(1 − t^1.52) (Godeke 2006). Strain dependence is not modelled: this is the unstrained upper bound.",
    },
    presentation: {
      color: "#8a7f9e",
      metalness: 0.55,
      roughness: 0.5,
      thermalResponse: "superconductor",
      combustible: false,
    },
    sourceSummary: "Godeke (2006) review; density derived from the A15 lattice.",
    notes: [
      "Brittle intermetallic formed by heat treatment after winding; strain in the finished cable reduces Tc and Bc2.",
      "At 12 T the unstrained critical temperature is about 12 K.",
    ],
  },
  {
    id: "rebco",
    name: "REBCO",
    grade: "REBa₂Cu₃O₇₋δ (YBCO-class) coated-conductor superconducting layer",
    category: "superconductor",
    summary: "High-temperature superconductor tape for compact high-field magnets.",
    density: q(6380, "kg/m³", "derived", "approximate", {
      note: "Theoretical (X-ray) density of YBa₂Cu₃O₇.",
    }),
    superconducting: {
      criticalTemperatureZeroField: q(92, "K", "wu-1987", "handbook", { range: [90, 93] }),
      criticalSurface: null,
      note: "Its upper critical field exceeds 100 T at low temperature and is strongly anisotropic; a field-dependent critical surface is not catalogued, so REBCO is reference data only for now.",
    },
    presentation: {
      color: "#5f6f7a",
      metalness: 0.5,
      roughness: 0.4,
      thermalResponse: "superconductor",
      combustible: false,
    },
    sourceSummary: "Wu et al. (1987) critical temperature; derived density.",
    notes: [
      "A real tape is mostly Hastelloy substrate and copper; the superconducting layer is a few micrometres thick.",
    ],
  },
  {
    id: "mgb2",
    name: "Magnesium Diboride",
    grade: "MgB₂",
    category: "superconductor",
    summary: "Low-cost intermediate-temperature superconductor (≈20 K operation).",
    density: q(2620, "kg/m³", "derived", "approximate", {
      note: "From the hexagonal cell: a = 3.086 Å, c = 3.524 Å, one formula unit (45.93 g/mol).",
    }),
    superconducting: {
      criticalTemperatureZeroField: q(39, "K", "nagamatsu-2001", "handbook"),
      criticalSurface: null,
      note: "Field dependence depends strongly on doping and processing; not catalogued.",
    },
    presentation: {
      color: "#6d6a62",
      metalness: 0.4,
      roughness: 0.55,
      thermalResponse: "superconductor",
      combustible: false,
    },
    sourceSummary: "Nagamatsu et al. (2001); derived density.",
    notes: ["Reference data only: no critical surface catalogued."],
  },

  /* ---------------------------------------------------------------------------------- *
   * Electrical and thermal insulation, ceramics
   * ---------------------------------------------------------------------------------- */
  {
    id: "g10-cr",
    name: "G-10CR Fiberglass Epoxy",
    grade: "NEMA G-10CR woven glass / epoxy laminate (cryogenic grade)",
    category: "insulator-ceramic",
    summary: "Magnet ground insulation and cryogenic supports.",
    density: q(1800, "kg/m³", "supplier-datasheet", "typical", { range: [1700, 1900] }),
    thermal: {
      specificHeat: q(999, "J/(kg·K)", "nist-cryo", "handbook", {
        at: "300 K",
        note: "2.8 J/(kg·K) at 4.5 K.",
      }),
      conductivity: q(0.61, "W/(m·K)", "nist-cryo", "handbook", {
        at: "300 K, normal direction",
        note: "0.08 W/(m·K) at 4.5 K.",
      }),
      maxService: q(C(130), "K", "supplier-datasheet", "approximate", {
        note: "Epoxy-glass laminates of this class are rated for continuous use around 130 °C; above it the resin softens and degrades.",
      }),
    },
    electrical: { insulator: true },
    presentation: {
      color: "#b9a35e",
      metalness: 0,
      roughness: 0.7,
      thermalResponse: "char",
      combustible: {
        ignition: q(C(400), "K", "polymer-handbook", "approximate", {
          range: [C(350), C(450)],
          note: "Epoxy resin decomposes and can burn from roughly 350–450 °C; the glass does not burn.",
        }),
        smoke: "sooty",
      },
    },
    sourceSummary:
      "NIST cryogenic material properties (G-10CR) curve fits at 300 K; density from supplier datasheets.",
    notes: [
      "Specific heat 999 J/(kg·K) and normal-direction conductivity 0.61 W/(m·K) are the NIST G-10CR fits evaluated at 300 K (2 % and 5 % fit error).",
      "Density: specific gravity 1.8 (Atlas Fibre G10 datasheet); other suppliers quote 1.70–1.90.",
      "At 4.5 K the NIST fits give 2.8 J/(kg·K) and 0.08 W/(m·K): insulation is a thermal barrier in a magnet.",
    ],
  },
  {
    id: "alumina",
    name: "Alumina",
    grade: "99.5 % aluminium oxide (CoorsTek AD-995)",
    category: "insulator-ceramic",
    summary: "Feedthroughs, bushings and high-voltage insulators.",
    density: q(3900, "kg/m³", "coorstek-ad995", "typical"),
    mechanical: {
      flexuralStrength: MPa(375, "coorstek-ad995", "typical"),
      compressiveStrength: MPa(2600, "coorstek-ad995", "typical"),
      youngsModulus: GPa(370, "coorstek-ad995", "typical"),
    },
    thermal: {
      specificHeat: q(880, "J/(kg·K)", "coorstek-ad995", "typical"),
      conductivity: q(35, "W/(m·K)", "coorstek-ad995", "typical", { at: "20 °C" }),
      expansion: q(8.2e-6, "1/K", "coorstek-ad995", "typical", { at: "25–1000 °C" }),
      melting: q(2345, "K", "crc", "handbook", { note: "2072 °C." }),
      maxService: q(C(1700), "K", "coorstek-ad995", "typical"),
    },
    electrical: {
      insulator: true,
      resistivity: q(1e12, "Ω·m", "coorstek-ad995", "typical", {
        note: "Volume resistivity > 10¹⁴ Ω·cm at 25 °C.",
      }),
      dielectricStrength: q(8.7e6, "V/m", "coorstek-ad995", "typical", {
        note: "Thickness-dependent.",
      }),
    },
    magnetic: { ferromagnetic: false },
    presentation: {
      color: "#e9e4d8",
      metalness: 0,
      roughness: 0.55,
      thermalResponse: "ceramic",
      combustible: false,
    },
    sourceSummary: "CoorsTek AD-995 datasheet; CRC melting point.",
    notes: ["Brittle: cracks under thermal shock rather than yielding."],
  },
  {
    id: "kapton",
    name: "Polyimide (Kapton HN)",
    grade: "DuPont Kapton HN polyimide film",
    category: "insulator-ceramic",
    summary: "Turn insulation and cryogenic electrical insulation.",
    density: q(1420, "kg/m³", "dupont-kapton-hn", "typical"),
    mechanical: {
      ultimateStrength: MPa(231, "dupont-kapton-hn", "typical"),
      youngsModulus: GPa(2.5, "dupont-kapton-hn", "typical"),
    },
    thermal: {
      specificHeat: q(1090, "J/(kg·K)", "dupont-kapton-hn", "typical"),
      conductivity: q(0.12, "W/(m·K)", "dupont-kapton-hn", "typical"),
      maxService: q(C(400), "K", "dupont-kapton-hn", "typical", {
        note: "Rated from −269 °C to 400 °C.",
      }),
      minService: q(4, "K", "dupont-kapton-hn", "typical"),
    },
    electrical: {
      insulator: true,
      resistivity: q(1.5e15, "Ω·m", "dupont-kapton-hn", "typical"),
      dielectricStrength: q(303e6, "V/m", "dupont-kapton-hn", "typical", { at: "25 µm film" }),
    },
    presentation: {
      color: "#c98a2b",
      metalness: 0,
      roughness: 0.4,
      thermalResponse: "char",
      combustible: false,
    },
    sourceSummary: "DuPont Kapton HN datasheet (typical).",
    notes: [
      "Flame-retardant (UL 94 V-0): it chars rather than sustaining a flame, so it is not counted as combustible.",
    ],
  },
  {
    id: "xlpe",
    name: "XLPE cable insulation",
    grade: "Cross-linked polyethylene power-cable insulation",
    category: "insulator-ceramic",
    summary: "Power-cable insulation — and the main fire load in an electrical gallery.",
    density: q(920, "kg/m³", "polymer-handbook", "typical", { range: [910, 940] }),
    thermal: {
      maxService: q(C(90), "K", "iec-60502", "specified", {
        note: "Maximum conductor temperature in normal operation.",
      }),
    },
    electrical: { insulator: true },
    presentation: {
      color: "#1f2227",
      metalness: 0,
      roughness: 0.75,
      thermalResponse: "char",
      combustible: {
        ignition: q(C(350), "K", "polymer-handbook", "approximate", {
          range: [C(330), C(410)],
          note: "Autoignition range quoted for polyethylene; heat of combustion ≈ 46 MJ/kg.",
        }),
        smoke: "sooty",
        heatOfCombustion: q(43.3e6, "J/kg", "polymer-handbook", "approximate", {
          range: [38.4e6, 46.5e6],
          note: "Effective heat of combustion of polyethylene in a fire (SFPE Handbook tabulations); complete combustion ≈ 46 MJ/kg, the chemical heat released by a sooty flame ≈ 38 MJ/kg. XLPE is taken as polyethylene.",
        }),
        burningRate: q(0.026, "kg/(m²·s)", "polymer-handbook", "approximate", {
          range: [0.014, 0.026],
          note: "Asymptotic free-burning mass flux of polyethylene in large-scale tests (SFPE Handbook); small or vertical samples burn more slowly. Taken as the rate over the part's whole outer surface once alight.",
        }),
      },
    },
    sourceSummary: "IEC 60502 temperature limits; polymer handbook density and fire data.",
    notes: [
      "IEC 60502 allows 250 °C for at most 5 s during a short circuit; beyond that the insulation is damaged.",
      "Polyethylene burns with heavy black smoke.",
    ],
  },

  /* ---------------------------------------------------------------------------------- *
   * Nuclear / blanket and civil
   * ---------------------------------------------------------------------------------- */
  {
    id: "concrete-c30",
    name: "Concrete",
    grade: "Normal-weight concrete, strength class C30/37",
    category: "civil",
    summary: "Floors, foundations and the biological shield around a reactor.",
    density: q(2400, "kg/m³", "en1992", "specified", {
      note: "EN 1991-1-1 plain normal-weight concrete (24 kN/m³); 2500 when reinforced.",
    }),
    mechanical: {
      compressiveStrength: MPa(30, "en1992", "specified", {
        note: "Characteristic cylinder strength fck.",
      }),
      youngsModulus: GPa(33, "en1992", "specified", { note: "Secant modulus Ecm." }),
    },
    thermal: {
      specificHeat: q(900, "J/(kg·K)", "en1992", "specified", { at: "20–100 °C, dry" }),
      conductivity: q(1.36, "W/(m·K)", "en1992", "specified", {
        range: [1.36, 1.95],
        at: "20 °C",
        note: "EN 1992-1-2 lower and upper limits.",
      }),
    },
    nuclear: {
      role: ["shield"],
      source: "en1992",
      notes: [
        "Its hydrogen (in bound water) slows neutrons and its mass stops gamma rays: the standard biological shield.",
      ],
    },
    presentation: {
      color: "#8f8c86",
      metalness: 0,
      roughness: 0.95,
      thermalResponse: "ceramic",
      combustible: false,
    },
    sourceSummary: "EN 1992 / EN 1991 values for C30/37.",
    notes: [
      "Reference data only: concrete is strong in compression and weak in tension, which the structural solver does not distinguish.",
    ],
  },
]);
