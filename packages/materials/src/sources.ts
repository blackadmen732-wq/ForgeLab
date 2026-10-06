/**
 * Every source the material library cites, by key. A value's `source` must be one of
 * these keys (checked by the tests). Full discussion of each value is in
 * docs/material-sources.md.
 *
 * These are the documents the conventional values come from. ForgeLab's numbers were
 * transcribed by hand and have not been re-verified against purchased copies of every
 * standard: the library is engineering-sandbox data, not certified design data.
 */
export interface SourceReference {
  readonly key: string;
  readonly citation: string;
  readonly kind: "standard" | "handbook" | "datasheet" | "paper" | "derived";
}

const list: readonly SourceReference[] = [
  {
    key: "crc",
    kind: "handbook",
    citation:
      "CRC Handbook of Chemistry and Physics (W. M. Haynes, ed.), sections on properties of the elements, electrical resistivity of pure metals and thermal conductivity.",
  },
  {
    key: "astm-a36",
    kind: "standard",
    citation:
      "ASTM A36/A36M, Standard Specification for Carbon Structural Steel (minimum mechanical properties).",
  },
  {
    key: "astm-a572",
    kind: "standard",
    citation:
      "ASTM A572/A572M, High-Strength Low-Alloy Columbium-Vanadium Structural Steel (Grade 50 minimums).",
  },
  {
    key: "astm-a240",
    kind: "standard",
    citation:
      "ASTM A240/A240M, Chromium and Chromium-Nickel Stainless Steel Plate, Sheet, and Strip (minimum mechanical properties for 304L and 316L).",
  },
  {
    key: "astm-b265",
    kind: "standard",
    citation: "ASTM B265, Titanium and Titanium Alloy Strip, Sheet, and Plate (Grade 5 minimums).",
  },
  {
    key: "astm-b230",
    kind: "standard",
    citation:
      "ASTM B230/B230M, Aluminum 1350-H19 Wire for Electrical Purposes (minimum conductivity 61.0 % IACS).",
  },
  {
    key: "astm-b170",
    kind: "standard",
    citation:
      "ASTM B170, Oxygen-Free Electrolytic Copper — Refinery Shapes (C10100, minimum conductivity 101 % IACS).",
  },
  {
    key: "en1993-1-1",
    kind: "standard",
    citation: "EN 1993-1-1 (Eurocode 3), Design of steel structures — General rules, §3.2.6.",
  },
  {
    key: "en1993-1-2",
    kind: "standard",
    citation:
      "EN 1993-1-2 (Eurocode 3), Structural fire design, Table 3.1: reduction factors for carbon steel at elevated temperature.",
  },
  {
    key: "en1992",
    kind: "standard",
    citation:
      "EN 1992-1-1 Table 3.1 (strength classes) and EN 1992-1-2 §3.3 (thermal properties of concrete); EN 1991-1-1 Annex A (densities).",
  },
  {
    key: "asm-datasheet",
    kind: "datasheet",
    citation:
      "ASM International / producer datasheets for the named wrought grade (typical values; ASM Handbook Vol. 2 for aluminium alloys).",
  },
  {
    key: "supplier-datasheet",
    kind: "datasheet",
    citation:
      "Producer datasheets for the named grade (typical values; supplier-to-supplier spread is stated in the note).",
  },
  {
    key: "toyo-tanso-ig110",
    kind: "datasheet",
    citation: "Toyo Tanso IG-110 isotropic graphite, typical properties datasheet.",
  },
  {
    key: "coorstek-ad995",
    kind: "datasheet",
    citation: "CoorsTek AD-995 (99.5 % alumina), material properties datasheet.",
  },
  {
    key: "cvd-sic-datasheet",
    kind: "datasheet",
    citation:
      "Producer datasheets for high-purity CVD β-SiC (Rohm and Haas / Dow 'CVD SILICON CARBIDE'; CoorsTek PureSiC).",
  },
  {
    key: "dupont-kapton-hn",
    kind: "datasheet",
    citation: "DuPont Kapton HN polyimide film, general specifications (25 µm film unless stated).",
  },
  {
    key: "nist-cryo",
    kind: "handbook",
    citation:
      "NIST Cryogenic Material Properties database (curve fits for G-10CR and other cryogenic materials).",
  },
  {
    key: "iec-60502",
    kind: "standard",
    citation:
      "IEC 60502-1/-2, Power cables with extruded insulation: maximum conductor temperatures for XLPE (90 °C normal, 250 °C short circuit).",
  },
  {
    key: "iec-60296",
    kind: "standard",
    citation:
      "IEC 60296, Fluids for electrotechnical applications — mineral insulating oils (flash point and density limits).",
  },
  {
    key: "polymer-handbook",
    kind: "handbook",
    citation:
      "Polymer handbooks (Brandrup, Immergut & Grulke, Polymer Handbook; SFPE Handbook of Fire Protection Engineering) for polyethylene density, heat of combustion and ignition.",
  },
  {
    key: "materion-s65",
    kind: "datasheet",
    citation: "Materion S-65 beryllium, specification minimums and typical physical properties.",
  },
  {
    key: "bottura-2000",
    kind: "paper",
    citation:
      "L. Bottura, 'A practical fit for the critical surface of NbTi', IEEE Trans. Appl. Supercond. 10 (2000) 1054; after M. S. Lubell, IEEE Trans. Magn. 19 (1983) 754.",
  },
  {
    key: "godeke-2006",
    kind: "paper",
    citation:
      "A. Godeke, 'A review of the properties of Nb3Sn and their variation with A15 composition, morphology and strain state', Supercond. Sci. Technol. 19 (2006) R68.",
  },
  {
    key: "wu-1987",
    kind: "paper",
    citation:
      "M. K. Wu et al., 'Superconductivity at 93 K in a new mixed-phase Y-Ba-Cu-O compound system at ambient pressure', Phys. Rev. Lett. 58 (1987) 908.",
  },
  {
    key: "nagamatsu-2001",
    kind: "paper",
    citation:
      "J. Nagamatsu et al., 'Superconductivity at 39 K in magnesium diboride', Nature 410 (2001) 63.",
  },
  {
    key: "rieth-2003",
    kind: "paper",
    citation:
      "M. Rieth et al., 'EUROFER 97: tensile, Charpy, creep and structural tests', Forschungszentrum Karlsruhe report FZKA 6911 (2003).",
  },
  {
    key: "mas-de-les-valls-2008",
    kind: "paper",
    citation:
      "E. Mas de les Valls et al., 'Lead–lithium eutectic material database for nuclear fusion technology', J. Nucl. Mater. 376 (2008) 353.",
  },
  {
    key: "iapws",
    kind: "handbook",
    citation:
      "IAPWS-95 / IAPWS-IF97 formulations for the thermodynamic properties of ordinary water substance.",
  },
  {
    key: "nist-webbook",
    kind: "handbook",
    citation:
      "NIST Chemistry WebBook, Thermophysical Properties of Fluid Systems (helium, normal deuterium).",
  },
  {
    key: "nubase-2020",
    kind: "handbook",
    citation:
      "F. G. Kondev et al., 'The NUBASE2020 evaluation of nuclear physics properties', Chin. Phys. C 45 (2021) 030001 (tritium half-life 12.32 y).",
  },
  {
    key: "fusion-physics",
    kind: "handbook",
    citation:
      "Standard fusion-reaction energetics: D + T → ⁴He (3.52 MeV) + n (14.07 MeV), Q = 17.59 MeV; ⁶Li + n → T + ⁴He + 4.78 MeV.",
  },
  {
    key: "derived",
    kind: "derived",
    citation:
      "Derived by ForgeLab from other cited values; the derivation is stated in the value's note.",
  },
  {
    key: "feng-2018",
    kind: "paper",
    citation:
      "X. Feng, M. Ouyang, X. Liu, L. Lu, Y. Xia, X. He, 'Thermal runaway mechanism of lithium ion battery for electric vehicles: A review', Energy Storage Materials 10 (2018) 246–267. Defines T1/T2/T3 from ARC tests and reports their ranges by chemistry.",
  },
  {
    key: "golubkov-2014",
    kind: "paper",
    citation:
      "A. W. Golubkov et al., 'Thermal-runaway experiments on consumer Li-ion batteries with metal-oxide and olivin-type cathodes', RSC Advances 4 (2014) 3633–3642. Maximum temperatures (LFP ≈ 404 °C, NMC ≈ 680 °C, LCO/NMC ≈ 850 °C) and vent gas amount and composition.",
  },
  {
    key: "baird-2020",
    kind: "paper",
    citation:
      "A. R. Baird, E. J. Archibald, K. C. Marr, O. A. Ezekoye, 'Explosion hazards from lithium-ion battery vent gas', Journal of Power Sources 446 (2020) 227257. Lower flammability limits and combustion properties of vent gas mixtures.",
  },
  {
    key: "li-ion-cell-typical",
    kind: "derived",
    citation:
      "Typical large-format prismatic Li-ion cell values (density from cell mass and envelope, specific heat from cell calorimetry, ≈ 0.9–1.1 kJ/(kg·K)) as quoted across the battery thermal-modelling literature.",
  },
];

export const SOURCES: ReadonlyMap<string, SourceReference> = new Map(list.map((s) => [s.key, s]));

export function sourceCitation(key: string): string {
  return SOURCES.get(key)?.citation ?? key;
}
