# Material sources

Every number in the material library (`packages/materials/src/library.ts` and
`fluids.ts`) is recorded here with where it came from and what it does and does not mean.
Nothing in ForgeLab's material database is a gameplay number, and nothing was chosen to
make something fail or survive.

## The library

The library holds about thirty deeply described materials and fluids rather than hundreds
of shallow ones, grouped by engineering function: structural metals, conductors,
plasma-facing and high-temperature materials, superconductors, insulators and ceramics,
nuclear and civil materials, and fluids.

**Property groups, not a flat table.** A material carries only the groups that apply to it
— mechanical, thermal, electrical, magnetic, superconducting, nuclear, plasma-facing, and
presentation — and within a group only the values we have a source for. **A missing value
is unknown, never zero.** Fluids have their own schema: properties at named thermodynamic
states (pressure and temperature), phase-change points, and what a release looks like.

**Every number carries** its SI unit, a source key (listed in
`packages/materials/src/sources.ts` and below), the conditions it applies at, its spread
where the spread matters, and a confidence:

| Confidence    | Meaning                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `specified`   | A standard's minimum or maximum (ASTM, EN, IEC). Real stock is usually better.                              |
| `handbook`    | A conventional reference value for a pure substance (CRC, IAPWS, NIST).                                     |
| `typical`     | A datasheet or handbook typical for a grade; process-dependent.                                             |
| `approximate` | A wide spread between sources or processes, or derived by ForgeLab — the derivation is in the value's note. |

**Temperature-dependent properties** are tabulated curves (piecewise-linear, held constant
outside the table, never extrapolated): EN 1993-1-2 strength and stiffness reduction for
carbon steels, and the CRC resistivity of copper from 100 K to 900 K.

**Structural catalogue.** Only a material with every value the solvers need — density,
yield strength, Young's modulus, specific heat, conductivity, resistivity and a service
limit — can be assigned to a placed part. The others (EUROFER97, graphite, SiC, beryllium,
1350 aluminium, concrete, the superconductors and insulators) are reference data, used as
internal regions of finished machines or shown in the Material Lab, until their missing
values are sourced. Nothing is filled in to make them placeable.

**Presentation** (colour, metalness, roughness, how the surface responds to heat, and
whether the material can burn) decides only how a material looks. Every threshold that
decides _when_ it reacts comes from the physical groups — melting, service limit,
decomposition, ignition — and every combustible material has a sourced ignition
temperature. Metals are never combustible.

## How to read this document

**Scope of these values.** Each entry is a _nominal handbook or supplier-datasheet figure
for one named grade_, at room temperature unless stated. They were transcribed by hand at
the precision shown. They have not been re-verified against a purchased copy of the
underlying standard, and they are not certified material data. ForgeLab is an engineering
sandbox. Do not design anything real from this table.

**Grades matter more than names.** "Stainless steel" spans a factor of four in yield
strength depending on grade and temper. Each material therefore records the specific grade
its numbers describe, and that grade is part of the data, not a label.

**What `maxOperatingTemperatureK` means.** It is used consistently across the catalogue as
_the maximum continuous service temperature at which the grade retains its listed
room-temperature structural properties_. It is **not** a melting point, **not** a
creep-rupture limit, and **not** a design code allowable. The plant solver raises an
over-temperature failure when a part passes it (`thermal.maxService` in the library).

**Mostly single scalars.** Density, conductivity and resistivity all vary with
temperature; strength varies a great deal. Most properties are one value at the stated
conditions; the curves listed above are the exceptions so far.

**Sources cited by class.** Where an entry says "ASTM A36", the figure is the value that
specification is universally quoted as setting. Where it says "CRC Handbook" or "supplier
datasheet", the figure is the conventional handbook value for the pure metal or the grade.
Where a property is strongly process-dependent, the spread is stated in the notes rather
than smoothed away.

---

## The original structural catalogue in detail

The five materials ForgeLab started with are discussed at length here; their numbers have
not changed. Every library entry, these included, is tabulated with sources under
[Library entries](#library-entries).

## Structural Steel — ASTM A36 hot-rolled carbon steel

| Property                    | Value           | Source and meaning                                                                                                                                                 |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `densityKgM3`               | 7850            | Conventional density for carbon steel (7.85 g/cm³).                                                                                                                |
| `yieldStrengthPa`           | 250 × 10⁶       | ASTM A36/A36M **specified minimum** yield strength (250 MPa / 36 ksi) for thickness up to 200 mm. Real stock routinely tests above this.                           |
| `maxOperatingTemperatureK`  | 673.15 (400 °C) | EN 1993-1-2 (Eurocode 3, structural fire design) applies **no reduction** to effective yield strength up to 400 °C. Above it, carbon steel loses strength quickly. |
| `thermalConductivityWmK`    | 45.0            | Conventional handbook value for low-carbon structural steel near room temperature.                                                                                 |
| `electricalResistivityOhmM` | 1.6 × 10⁻⁷      | Typical low-carbon steel. Handbook values span roughly 1.4–1.8 × 10⁻⁷ Ω·m with carbon and alloy content.                                                           |

**Caveats.** A36 is a _minimum-strength_ specification, so ForgeLab's structural results
using it are conservative relative to real stock. Resistivity for steels is composition
sensitive and the single value here should be treated as indicative only.

## Stainless Steel — AISI 316L austenitic, annealed

| Property                    | Value            | Source and meaning                                                                                                                                                      |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `densityKgM3`               | 8000             | Conventional density for austenitic stainless (≈7.99 g/cm³).                                                                                                            |
| `yieldStrengthPa`           | 170 × 10⁶        | ASTM A240 minimum 0.2 % proof stress for annealed **316L**.                                                                                                             |
| `maxOperatingTemperatureK`  | 1143.15 (870 °C) | Intermittent-service scaling limit in air. Continuous service in air is usually quoted as 925 °C; the lower figure is used because thermal cycling is the harsher case. |
| `thermalConductivityWmK`    | 16.3             | Quoted at 100 °C. At 20 °C it is nearer 14.6 W/(m·K).                                                                                                                   |
| `electricalResistivityOhmM` | 7.4 × 10⁻⁷       | Conventional value for 316/316L (74 µΩ·cm).                                                                                                                             |

**Caveats.** Do **not** substitute non-low-carbon 316, which is specified at 205 MPa — a
20 % difference that propagates straight into every stress result. The scaling limit is an
oxidation figure: pressure-retaining design codes allow far lower temperatures because of
creep, which ForgeLab does not model.

## Tungsten — pure sintered (≥ 99.95 %), stress-relieved

| Property                    | Value             | Source and meaning                                                                |
| --------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| `densityKgM3`               | 19250             | CRC Handbook value for pure tungsten (19.25 g/cm³).                               |
| `yieldStrengthPa`           | 550 × 10⁶         | Conservative figure for sintered, stress-relieved stock.                          |
| `maxOperatingTemperatureK`  | 1573.15 (1300 °C) | Approximate recrystallization onset for pure tungsten, above which it embrittles. |
| `thermalConductivityWmK`    | 173               | CRC Handbook, pure tungsten near 300 K.                                           |
| `electricalResistivityOhmM` | 5.6 × 10⁻⁸        | CRC Handbook, tungsten at 20 °C.                                                  |

**Caveats.** Tungsten's strength is extremely process-dependent: worked rod and wire are
quoted anywhere from 750 MPa to well over 1500 MPa. 550 MPa is deliberately the
conservative end. The temperature figure is **not** the melting point (3422 °C), and it
assumes vacuum or an inert atmosphere — in air, oxidation limits tungsten to a few hundred
degrees Celsius. ForgeLab does not model atmosphere yet.

## Copper — C11000 electrolytic tough pitch, annealed (O60)

| Property                    | Value           | Source and meaning                                                                                                  |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `densityKgM3`               | 8960            | CRC Handbook, pure copper (8.96 g/cm³).                                                                             |
| `yieldStrengthPa`           | 69 × 10⁶        | Datasheet 0.2 % proof stress for C11000 in the annealed (O60) temper.                                               |
| `maxOperatingTemperatureK`  | 473.15 (200 °C) | Softening/annealing service limit for cold-worked copper. Not a melting or oxidation limit.                         |
| `thermalConductivityWmK`    | 401             | CRC Handbook, pure copper at 300 K.                                                                                 |
| `electricalResistivityOhmM` | 1.678 × 10⁻⁸    | CRC Handbook, annealed copper at 20 °C — about 103 % IACS. The IACS reference standard itself is 1.7241 × 10⁻⁸ Ω·m. |

**Caveats.** Temper matters more than grade for copper: cold-worked C11000 (H04) reaches
roughly 310 MPa, four and a half times the annealed figure. ForgeLab models the annealed
temper, which is why copper makes such a poor structural column in the workspace — that is
a real property of the material, not a penalty.

## Aluminum — 6061-T6

| Property                    | Value           | Source and meaning                                                                                   |
| --------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `densityKgM3`               | 2700            | Conventional density for 6061 (2.70 g/cm³).                                                          |
| `yieldStrengthPa`           | 276 × 10⁶       | Typical 6061-T6 0.2 % proof stress (40 ksi), ASM/supplier datasheet.                                 |
| `maxOperatingTemperatureK`  | 473.15 (200 °C) | Over-ageing limit: held above it the T6 temper degrades permanently and does not recover on cooling. |
| `thermalConductivityWmK`    | 167             | Datasheet value for 6061-T6.                                                                         |
| `electricalResistivityOhmM` | 3.99 × 10⁻⁸     | Datasheet value for 6061-T6 (3.99 µΩ·cm).                                                            |

**Caveats.** Temper again: the same alloy in T4 is around 145 MPa. 6061-T6 is stronger than
ASTM A36 structural steel by yield stress while being under a third its density — which is
exactly why it is worth having in the catalogue.

---

## Structural 0.1 and thermal additions

Two properties were added for Structural 0.1 (buckling, bending) and the V0.1 lumped
thermal model. Both are conventional room-temperature handbook values.

| Material         | `youngsModulusPa` | `specificHeatJkgK` | Source and meaning                                                                                             |
| ---------------- | ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| ASTM A36 steel   | 200 × 10⁹         | 486                | Conventional E for carbon steel (AISC uses 29 000 ksi ≈ 200 GPa). cp ≈ 0.486 kJ/(kg·K), handbook at 20–100 °C. |
| 316L stainless   | 193 × 10⁹         | 500                | Supplier datasheet E for annealed 316/316L; cp 0.50 kJ/(kg·K) at 0–100 °C.                                     |
| Pure tungsten    | 411 × 10⁹         | 132                | CRC Handbook E ≈ 411 GPa; cp from 24.27 J/(mol·K) ÷ 183.84 g/mol.                                              |
| C11000 copper    | 117 × 10⁹         | 385                | Handbook E for annealed copper spans ~110–128 GPa; 117 GPa is the common datasheet figure. cp 0.385 kJ/(kg·K). |
| 6061-T6 aluminum | 68.9 × 10⁹        | 896                | ASM datasheet E = 68.9 GPa (10 000 ksi); cp 0.896 kJ/(kg·K).                                                   |

**Caveats.** Both properties fall with temperature (steel E is roughly 10 % lower at
400 °C; cp rises). ForgeLab V0.1 uses the room-temperature scalar everywhere and does not
yet derate stiffness or strength with temperature.

---

## Sources

| Key                     | Source                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crc`                   | CRC Handbook of Chemistry and Physics (W. M. Haynes, ed.), sections on properties of the elements, electrical resistivity of pure metals and thermal conductivity.         |
| `astm-a36`              | ASTM A36/A36M, Standard Specification for Carbon Structural Steel (minimum mechanical properties).                                                                         |
| `astm-a572`             | ASTM A572/A572M, High-Strength Low-Alloy Columbium-Vanadium Structural Steel (Grade 50 minimums).                                                                          |
| `astm-a240`             | ASTM A240/A240M, Chromium and Chromium-Nickel Stainless Steel Plate, Sheet, and Strip (minimum mechanical properties for 304L and 316L).                                   |
| `astm-b265`             | ASTM B265, Titanium and Titanium Alloy Strip, Sheet, and Plate (Grade 5 minimums).                                                                                         |
| `astm-b230`             | ASTM B230/B230M, Aluminum 1350-H19 Wire for Electrical Purposes (minimum conductivity 61.0 % IACS).                                                                        |
| `astm-b170`             | ASTM B170, Oxygen-Free Electrolytic Copper — Refinery Shapes (C10100, minimum conductivity 101 % IACS).                                                                    |
| `en1993-1-1`            | EN 1993-1-1 (Eurocode 3), Design of steel structures — General rules, §3.2.6.                                                                                              |
| `en1993-1-2`            | EN 1993-1-2 (Eurocode 3), Structural fire design, Table 3.1: reduction factors for carbon steel at elevated temperature.                                                   |
| `en1992`                | EN 1992-1-1 Table 3.1 (strength classes) and EN 1992-1-2 §3.3 (thermal properties of concrete); EN 1991-1-1 Annex A (densities).                                           |
| `asm-datasheet`         | ASM International / producer datasheets for the named wrought grade (typical values; ASM Handbook Vol. 2 for aluminium alloys).                                            |
| `supplier-datasheet`    | Producer datasheets for the named grade (typical values; supplier-to-supplier spread is stated in the note).                                                               |
| `toyo-tanso-ig110`      | Toyo Tanso IG-110 isotropic graphite, typical properties datasheet.                                                                                                        |
| `coorstek-ad995`        | CoorsTek AD-995 (99.5 % alumina), material properties datasheet.                                                                                                           |
| `cvd-sic-datasheet`     | Producer datasheets for high-purity CVD β-SiC (Rohm and Haas / Dow 'CVD SILICON CARBIDE'; CoorsTek PureSiC).                                                               |
| `dupont-kapton-hn`      | DuPont Kapton HN polyimide film, general specifications (25 µm film unless stated).                                                                                        |
| `nist-cryo`             | NIST Cryogenic Material Properties database (curve fits for G-10CR and other cryogenic materials).                                                                         |
| `iec-60502`             | IEC 60502-1/-2, Power cables with extruded insulation: maximum conductor temperatures for XLPE (90 °C normal, 250 °C short circuit).                                       |
| `iec-60296`             | IEC 60296, Fluids for electrotechnical applications — mineral insulating oils (flash point and density limits).                                                            |
| `polymer-handbook`      | Polymer handbooks (Brandrup, Immergut & Grulke, Polymer Handbook; SFPE Handbook of Fire Protection Engineering) for polyethylene density, heat of combustion and ignition. |
| `materion-s65`          | Materion S-65 beryllium, specification minimums and typical physical properties.                                                                                           |
| `bottura-2000`          | L. Bottura, 'A practical fit for the critical surface of NbTi', IEEE Trans. Appl. Supercond. 10 (2000) 1054; after M. S. Lubell, IEEE Trans. Magn. 19 (1983) 754.          |
| `godeke-2006`           | A. Godeke, 'A review of the properties of Nb3Sn and their variation with A15 composition, morphology and strain state', Supercond. Sci. Technol. 19 (2006) R68.            |
| `wu-1987`               | M. K. Wu et al., 'Superconductivity at 93 K in a new mixed-phase Y-Ba-Cu-O compound system at ambient pressure', Phys. Rev. Lett. 58 (1987) 908.                           |
| `nagamatsu-2001`        | J. Nagamatsu et al., 'Superconductivity at 39 K in magnesium diboride', Nature 410 (2001) 63.                                                                              |
| `rieth-2003`            | M. Rieth et al., 'EUROFER 97: tensile, Charpy, creep and structural tests', Forschungszentrum Karlsruhe report FZKA 6911 (2003).                                           |
| `mas-de-les-valls-2008` | E. Mas de les Valls et al., 'Lead–lithium eutectic material database for nuclear fusion technology', J. Nucl. Mater. 376 (2008) 353.                                       |
| `iapws`                 | IAPWS-95 / IAPWS-IF97 formulations for the thermodynamic properties of ordinary water substance.                                                                           |
| `nist-webbook`          | NIST Chemistry WebBook, Thermophysical Properties of Fluid Systems (helium, normal deuterium).                                                                             |
| `nubase-2020`           | F. G. Kondev et al., 'The NUBASE2020 evaluation of nuclear physics properties', Chin. Phys. C 45 (2021) 030001 (tritium half-life 12.32 y).                                |
| `fusion-physics`        | Standard fusion-reaction energetics: D + T → ⁴He (3.52 MeV) + n (14.07 MeV), Q = 17.59 MeV; ⁶Li + n → T + ⁴He + 4.78 MeV.                                                  |
| `derived`               | Derived by ForgeLab from other cited values; the derivation is stated in the value's note.                                                                                 |

## Library entries

Generated from the library; each row is one value with its source and confidence.

### Structural Steel — ASTM A36 hot-rolled carbon steel

`structural-steel` · structural-metal · The default carbon steel for frames, supports and plant structure.

| Property                    | Value                                                                 | Conditions            | Source          | Confidence  | Note                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------- | --------------------- | --------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density                     | 7850 kg/m³                                                            |                       | `crc`           | handbook    | Conventional carbon-steel density.                                                                                                                       |
| Yield strength (0.2 %)      | 250 MPa                                                               |                       | `astm-a36`      | specified   | Specified minimum for thickness ≤ 200 mm; real stock usually tests higher.                                                                               |
| Ultimate / tensile strength | 400 MPa (range 400 MPa – 550 MPa)                                     |                       | `astm-a36`      | specified   | Specified tensile range 400–550 MPa.                                                                                                                     |
| Young's modulus             | 200 GPa                                                               |                       | `en1993-1-1`    | specified   |                                                                                                                                                          |
| Poisson's ratio             | 0.3                                                                   |                       | `en1993-1-1`    | specified   |                                                                                                                                                          |
| Yield reduction ky(T)       | 10 points, 293.15–1473.15 K                                           |                       | `en1993-1-2`    | specified   | Effective yield strength ky,θ for carbon steels (S235–S460) in structural fire design. Applies to the A36 and A572 grades here, not to stainless steels. |
| Modulus reduction kE(T)     | 13 points, 293.15–1473.15 K                                           |                       | `en1993-1-2`    | specified   | Slope of the linear elastic range kE,θ for carbon steels.                                                                                                |
| Specific heat               | 486 J/(kg·K)                                                          | 20–100 °C             | `crc`           | handbook    |                                                                                                                                                          |
| Thermal conductivity        | 45 W/(m·K)                                                            | near room temperature | `crc`           | handbook    |                                                                                                                                                          |
| Expansion coefficient       | 1.2e-5 1/K                                                            |                       | `en1993-1-1`    | specified   |                                                                                                                                                          |
| Melting (solidus)           | 1698.15 K (1425 °C) (range 1698.15 K (1425 °C) – 1813.15 K (1540 °C)) |                       | `asm-datasheet` | approximate | Melting range of carbon steels; composition-dependent.                                                                                                   |
| Max. service temperature    | 673.15 K (400 °C)                                                     |                       | `en1993-1-2`    | specified   | EN 1993-1-2 applies no reduction to effective yield strength up to 400 °C.                                                                               |
| Electrical resistivity      | 1.6e-7 Ω·m (range 1.4e-7 Ω·m – 1.8e-7 Ω·m)                            | 20 °C                 | `crc`           | approximate |                                                                                                                                                          |
| Magnetic                    | ferromagnetic                                                         |                       |                 |             |                                                                                                                                                          |
| Curie temperature           | 1043 K (769.9 °C)                                                     |                       | `crc`           | handbook    | Curie point of iron (770 °C); carbon and low-alloy steels are ferromagnetic below it.                                                                    |

- 250 MPa is the ASTM A36 specified _minimum_ yield strength for thicknesses up to 200 mm; real stock typically tests higher.
- 400 degC is the temperature up to which EN 1993-1-2 applies no reduction to effective yield strength; above it carbon steel loses strength rapidly.
- Electrical resistivity for low-carbon steels spans roughly 1.4e-7 to 1.8e-7 ohm-m depending on carbon and alloy content.

### Stainless Steel — AISI 316L austenitic stainless, annealed

`stainless-steel` · structural-metal · Vacuum vessels, cryostats, coil cases and pressure parts.

| Property                    | Value                                                                 | Conditions | Source               | Confidence | Note                                                                                                         |
| --------------------------- | --------------------------------------------------------------------- | ---------- | -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Density                     | 8000 kg/m³                                                            |            | `supplier-datasheet` | typical    |                                                                                                              |
| Yield strength (0.2 %)      | 170 MPa                                                               |            | `astm-a240`          | specified  | Minimum 0.2 % proof stress, annealed 316L.                                                                   |
| Ultimate / tensile strength | 485 MPa                                                               |            | `astm-a240`          | specified  |                                                                                                              |
| Young's modulus             | 193 GPa                                                               |            | `supplier-datasheet` | typical    |                                                                                                              |
| Specific heat               | 500 J/(kg·K)                                                          | 0–100 °C   | `supplier-datasheet` | typical    |                                                                                                              |
| Thermal conductivity        | 16.3 W/(m·K)                                                          | 100 °C     | `supplier-datasheet` | typical    | Nearer 14.6 W/(m·K) at 20 °C.                                                                                |
| Expansion coefficient       | 1.6e-5 1/K                                                            | 0–100 °C   | `supplier-datasheet` | typical    |                                                                                                              |
| Melting (solidus)           | 1648.15 K (1375 °C) (range 1648.15 K (1375 °C) – 1673.15 K (1400 °C)) |            | `supplier-datasheet` | typical    |                                                                                                              |
| Max. service temperature    | 1143.15 K (870 °C)                                                    |            | `supplier-datasheet` | typical    | Intermittent-service scaling limit in air.                                                                   |
| Electrical resistivity      | 7.4e-7 Ω·m                                                            |            | `supplier-datasheet` | typical    |                                                                                                              |
| Magnetic                    | not ferromagnetic                                                     |            |                      |            | Austenitic: essentially non-magnetic when annealed; cold work and welds can raise the permeability slightly. |

- 170 MPa is the ASTM A240 minimum 0.2% proof stress for annealed 316L. Non-low-carbon 316 is specified at 205 MPa - do not substitute one for the other.
- 870 degC is the intermittent-service scaling limit in air; continuous service in air is usually quoted as 925 degC. The lower figure is used here because thermal cycling is the harsher case.
- Pressure-retaining design codes allow far lower temperatures than the scaling limit because of creep. ForgeLab does not model creep.
- Thermal conductivity is quoted at 100 degC; at 20 degC it is nearer 14.6 W/(m*K).

### Tungsten — Pure sintered tungsten (>= 99.95%), stress-relieved

`tungsten` · plasma-facing · Divertor and first-wall armour: the highest melting point of any metal.

| Property                 | Value                                                           | Conditions | Source               | Confidence  | Note                                                                                                     |
| ------------------------ | --------------------------------------------------------------- | ---------- | -------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| Density                  | 19250 kg/m³                                                     |            | `crc`                | handbook    |                                                                                                          |
| Yield strength (0.2 %)   | 550 MPa (range 550 MPa – 1.5 GPa)                               |            | `supplier-datasheet` | approximate | Conservative for sintered stock; worked rod and wire are far stronger.                                   |
| Young's modulus          | 411 GPa                                                         |            | `crc`                | handbook    |                                                                                                          |
| Specific heat            | 132 J/(kg·K)                                                    |            | `crc`                | handbook    | 24.27 J/(mol·K) ÷ 183.84 g/mol.                                                                          |
| Thermal conductivity     | 173 W/(m·K)                                                     | 300 K      | `crc`                | handbook    |                                                                                                          |
| Expansion coefficient    | 4.5e-6 1/K                                                      | 25 °C      | `crc`                | handbook    |                                                                                                          |
| Melting (solidus)        | 3695 K (3421.8 °C)                                              |            | `crc`                | handbook    | 3422 °C.                                                                                                 |
| Max. service temperature | 1573.15 K (1300 °C)                                             |            | `supplier-datasheet` | approximate | Approximate recrystallisation onset, above which tungsten embrittles. Assumes vacuum.                    |
| Min. service temperature | 673.15 K (400 °C) (range 473.15 K (200 °C) – 673.15 K (400 °C)) |            | `supplier-datasheet` | approximate | Ductile-to-brittle transition of unirradiated tungsten; below it tungsten fractures with little warning. |
| Electrical resistivity   | 5.6e-8 Ω·m                                                      | 20 °C      | `crc`                | handbook    |                                                                                                          |
| Magnetic                 | not ferromagnetic                                               |            |                      |             |                                                                                                          |

- Tungsten yield strength is extremely process-dependent: 550 MPa is a conservative figure for sintered stress-relieved stock, while heavily worked wire and rod are quoted from 750 MPa to well over 1500 MPa.
- 1300 degC is the approximate recrystallization onset for pure tungsten, above which it embrittles. It is NOT the melting point (3422 degC).
- In air, oxidation limits tungsten to a few hundred degC. The figure above assumes vacuum or inert atmosphere, which ForgeLab does not model yet.
- Highest melting point of any metal and low erosion by hydrogen-isotope sputtering, which is why ITER's divertor is tungsten.
- High atomic number: tungsten eroded into the plasma radiates strongly, so very little is tolerated.

### Copper — C11000 electrolytic tough pitch, annealed (O60)

`copper` · conductor · Busbars, resistive coils and the stabiliser of superconducting cable.

| Property                    | Value                             | Conditions | Source          | Confidence | Note                                                                                                                                                                                   |
| --------------------------- | --------------------------------- | ---------- | --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density                     | 8960 kg/m³                        |            | `crc`           | handbook   |                                                                                                                                                                                        |
| Yield strength (0.2 %)      | 69 MPa                            |            | `asm-datasheet` | typical    | Annealed temper; cold-worked H04 reaches ~310 MPa.                                                                                                                                     |
| Ultimate / tensile strength | 220 MPa                           |            | `asm-datasheet` | typical    |                                                                                                                                                                                        |
| Young's modulus             | 117 GPa (range 110 GPa – 128 GPa) |            | `asm-datasheet` | typical    |                                                                                                                                                                                        |
| Specific heat               | 385 J/(kg·K)                      |            | `crc`           | handbook   |                                                                                                                                                                                        |
| Thermal conductivity        | 401 W/(m·K)                       | 300 K      | `crc`           | handbook   |                                                                                                                                                                                        |
| Expansion coefficient       | 1.65e-5 1/K                       | 25 °C      | `crc`           | handbook   |                                                                                                                                                                                        |
| Melting (solidus)           | 1357.77 K (1084.6 °C)             |            | `crc`           | handbook   | 1084.62 °C.                                                                                                                                                                            |
| Max. service temperature    | 473.15 K (200 °C)                 |            | `asm-datasheet` | typical    | Softening/annealing limit, not a melting or oxidation limit.                                                                                                                           |
| Electrical resistivity      | 1.678e-8 Ω·m                      | 20 °C      | `crc`           | handbook   |                                                                                                                                                                                        |
| Resistivity ρ(T)            | 11 points, 100–900 K              |            | `crc`           | handbook   | Pure annealed copper. Below ~100 K the value depends on purity (residual resistance ratio) and is not tabulated here; above 900 K it is held at the 900 K value, which understates it. |
| Magnetic                    | not ferromagnetic                 |            |                 |            |                                                                                                                                                                                        |

- 69 MPa is annealed temper. Cold-worked C11000 (H04) reaches roughly 310 MPa - temper matters more than grade for copper.
- 200 degC is a softening/annealing service limit for cold-worked copper, not a melting or oxidation limit.
- 1.678e-8 ohm-m corresponds to about 103% IACS; the IACS reference standard itself is 1.7241e-8 ohm-m.
- Resistivity rises about 0.4 % per kelvin near room temperature: a hot busbar dissipates more, which heats it further.

### Aluminum — 6061-T6 aluminium alloy

`aluminum` · structural-metal · Light frames and housings.

| Property                    | Value                                                           | Conditions | Source          | Confidence | Note                                                                |
| --------------------------- | --------------------------------------------------------------- | ---------- | --------------- | ---------- | ------------------------------------------------------------------- |
| Density                     | 2700 kg/m³                                                      |            | `asm-datasheet` | typical    |                                                                     |
| Yield strength (0.2 %)      | 276 MPa                                                         |            | `asm-datasheet` | typical    |                                                                     |
| Ultimate / tensile strength | 310 MPa                                                         |            | `asm-datasheet` | typical    |                                                                     |
| Young's modulus             | 68.9 GPa                                                        |            | `asm-datasheet` | typical    |                                                                     |
| Specific heat               | 896 J/(kg·K)                                                    |            | `asm-datasheet` | typical    |                                                                     |
| Thermal conductivity        | 167 W/(m·K)                                                     |            | `asm-datasheet` | typical    |                                                                     |
| Expansion coefficient       | 2.36e-5 1/K                                                     | 20–100 °C  | `asm-datasheet` | typical    |                                                                     |
| Melting (solidus)           | 855.15 K (582 °C) (range 855.15 K (582 °C) – 925.15 K (652 °C)) |            | `asm-datasheet` | typical    | Solidus 582 °C, liquidus 652 °C — it melts before it visibly glows. |
| Max. service temperature    | 473.15 K (200 °C)                                               |            | `asm-datasheet` | typical    | Over-ageing limit: the T6 temper degrades permanently above it.     |
| Electrical resistivity      | 3.99e-8 Ω·m                                                     |            | `asm-datasheet` | typical    |                                                                     |
| Magnetic                    | not ferromagnetic                                               |            |                 |            |                                                                     |

- 276 MPa (40 ksi) is the typical 6061-T6 0.2% proof stress. The T4 temper of the same alloy is around 145 MPa.
- 200 degC is an over-ageing limit: held above it, T6 temper degrades permanently and does not recover on cooling.

### Stainless Steel 304L — AISI 304L austenitic stainless, annealed

`stainless-304l` · structural-metal · General-purpose austenitic stainless for ducts, frames and enclosures.

| Property                    | Value                                                                 | Conditions | Source               | Confidence | Note                                                           |
| --------------------------- | --------------------------------------------------------------------- | ---------- | -------------------- | ---------- | -------------------------------------------------------------- |
| Density                     | 8000 kg/m³ (range 7900 kg/m³ – 8000 kg/m³)                            |            | `supplier-datasheet` | typical    |                                                                |
| Yield strength (0.2 %)      | 170 MPa                                                               |            | `astm-a240`          | specified  |                                                                |
| Ultimate / tensile strength | 485 MPa                                                               |            | `astm-a240`          | specified  |                                                                |
| Young's modulus             | 193 GPa                                                               |            | `supplier-datasheet` | typical    |                                                                |
| Specific heat               | 500 J/(kg·K)                                                          | 0–100 °C   | `supplier-datasheet` | typical    |                                                                |
| Thermal conductivity        | 16.2 W/(m·K)                                                          | 100 °C     | `supplier-datasheet` | typical    |                                                                |
| Expansion coefficient       | 1.72e-5 1/K                                                           | 0–100 °C   | `supplier-datasheet` | typical    |                                                                |
| Melting (solidus)           | 1673.15 K (1400 °C) (range 1673.15 K (1400 °C) – 1723.15 K (1450 °C)) |            | `supplier-datasheet` | typical    |                                                                |
| Max. service temperature    | 1143.15 K (870 °C)                                                    |            | `supplier-datasheet` | typical    | Intermittent-service scaling limit in air (925 °C continuous). |
| Electrical resistivity      | 7.2e-7 Ω·m                                                            |            | `supplier-datasheet` | typical    |                                                                |
| Magnetic                    | not ferromagnetic                                                     |            |                      |            | Austenitic; slightly magnetic after cold work.                 |

- Same specified minimum proof stress as 316L (170 MPa); 316L's molybdenum buys corrosion resistance, not strength.
- Like 316L, creep — not modelled — limits pressure parts far below the scaling temperature.

### High-Strength Steel — ASTM A572 Grade 50 high-strength low-alloy steel

`hsla-steel` · structural-metal · Heavier-duty frames and supports: 38 % more yield than A36 for the same weight.

| Property                    | Value                                                                 | Conditions | Source          | Confidence  | Note                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------- | ---------- | --------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density                     | 7850 kg/m³                                                            |            | `crc`           | handbook    |                                                                                                                                                          |
| Yield strength (0.2 %)      | 345 MPa                                                               |            | `astm-a572`     | specified   | Specified minimum (50 ksi).                                                                                                                              |
| Ultimate / tensile strength | 450 MPa                                                               |            | `astm-a572`     | specified   |                                                                                                                                                          |
| Young's modulus             | 200 GPa                                                               |            | `en1993-1-1`    | specified   |                                                                                                                                                          |
| Poisson's ratio             | 0.3                                                                   |            | `en1993-1-1`    | specified   |                                                                                                                                                          |
| Yield reduction ky(T)       | 10 points, 293.15–1473.15 K                                           |            | `en1993-1-2`    | specified   | Effective yield strength ky,θ for carbon steels (S235–S460) in structural fire design. Applies to the A36 and A572 grades here, not to stainless steels. |
| Modulus reduction kE(T)     | 13 points, 293.15–1473.15 K                                           |            | `en1993-1-2`    | specified   | Slope of the linear elastic range kE,θ for carbon steels.                                                                                                |
| Specific heat               | 486 J/(kg·K)                                                          | 20–100 °C  | `crc`           | handbook    |                                                                                                                                                          |
| Thermal conductivity        | 45 W/(m·K)                                                            |            | `crc`           | approximate | Carbon-steel handbook value; low-alloy additions change it by a few percent.                                                                             |
| Expansion coefficient       | 1.2e-5 1/K                                                            |            | `en1993-1-1`    | specified   |                                                                                                                                                          |
| Melting (solidus)           | 1698.15 K (1425 °C) (range 1698.15 K (1425 °C) – 1813.15 K (1540 °C)) |            | `asm-datasheet` | approximate |                                                                                                                                                          |
| Max. service temperature    | 673.15 K (400 °C)                                                     |            | `en1993-1-2`    | specified   | EN 1993-1-2's reduction factors are the same for S235–S460 carbon steels.                                                                                |
| Electrical resistivity      | 1.6e-7 Ω·m (range 1.4e-7 Ω·m – 1.9e-7 Ω·m)                            |            | `crc`           | approximate |                                                                                                                                                          |
| Magnetic                    | ferromagnetic                                                         |            |                 |             |                                                                                                                                                          |
| Curie temperature           | 1043 K (769.9 °C)                                                     |            | `crc`           | handbook    | Curie point of iron (770 °C); carbon and low-alloy steels are ferromagnetic below it.                                                                    |

- Physical properties are those of carbon steel; only the strength differs from A36.
- Loses strength with temperature exactly as A36 does (EN 1993-1-2), so a hot A572 column is no safer in proportion.

### EUROFER97 — EUROFER97 reduced-activation ferritic-martensitic steel, normalised and tempered

`eurofer97` · nuclear · The European reference structural steel for breeding blankets.

| Property                 | Value                                      | Conditions       | Source       | Confidence  | Note                                                                            |
| ------------------------ | ------------------------------------------ | ---------------- | ------------ | ----------- | ------------------------------------------------------------------------------- |
| Density                  | 7750 kg/m³ (range 7740 kg/m³ – 7800 kg/m³) |                  | `rieth-2003` | approximate |                                                                                 |
| Yield strength (0.2 %)   | 530 MPa (range 500 MPa – 550 MPa)          | room temperature | `rieth-2003` | approximate | Unirradiated, as-received plate. Neutron irradiation hardens and embrittles it. |
| Young's modulus          | 217 GPa                                    | room temperature | `rieth-2003` | approximate |                                                                                 |
| Max. service temperature | 823.15 K (550 °C)                          |                  | `rieth-2003` | approximate | Upper end of the design temperature range, set by creep strength.               |
| Min. service temperature | 623.15 K (350 °C)                          |                  | `rieth-2003` | approximate | Below ~350 °C, irradiation raises the ductile-to-brittle transition sharply.    |
| Magnetic                 | ferromagnetic                              |                  |              |             | Ferromagnetic — it distorts a tokamak's field, which designs must allow for.    |

- Reference data only: thermal and electrical properties are not catalogued yet, so it cannot be assigned to a placed part.
- Values are for unirradiated material; irradiation changes strength and ductility substantially.
- Reduced activation: molybdenum, niobium and nickel are replaced by tungsten, tantalum and vanadium so that activated material decays to recyclable levels in decades rather than millennia.

### Aluminum 7075 — 7075-T6 aluminium alloy

`aluminum-7075` · structural-metal · High-strength aluminium for light structures that stay cool.

| Property                    | Value                                                           | Conditions | Source          | Confidence  | Note                                                                                                               |
| --------------------------- | --------------------------------------------------------------- | ---------- | --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Density                     | 2810 kg/m³                                                      |            | `asm-datasheet` | typical     |                                                                                                                    |
| Yield strength (0.2 %)      | 503 MPa                                                         |            | `asm-datasheet` | typical     |                                                                                                                    |
| Ultimate / tensile strength | 572 MPa                                                         |            | `asm-datasheet` | typical     |                                                                                                                    |
| Young's modulus             | 71.7 GPa                                                        |            | `asm-datasheet` | typical     |                                                                                                                    |
| Specific heat               | 960 J/(kg·K)                                                    |            | `asm-datasheet` | typical     |                                                                                                                    |
| Thermal conductivity        | 130 W/(m·K)                                                     |            | `asm-datasheet` | typical     |                                                                                                                    |
| Expansion coefficient       | 2.36e-5 1/K                                                     | 20–100 °C  | `asm-datasheet` | typical     |                                                                                                                    |
| Melting (solidus)           | 750.15 K (477 °C) (range 750.15 K (477 °C) – 908.15 K (635 °C)) |            | `asm-datasheet` | typical     | Solidus 477 °C, liquidus 635 °C.                                                                                   |
| Max. service temperature    | 393.15 K (120 °C)                                               |            | `derived`       | approximate | The T6 artificial-ageing temperature (≈121 °C); held above it the temper over-ages and strength falls permanently. |
| Electrical resistivity      | 5.15e-8 Ω·m                                                     |            | `asm-datasheet` | typical     | ≈ 33 % IACS.                                                                                                       |
| Magnetic                    | not ferromagnetic                                               |            |                 |             |                                                                                                                    |

- Nearly twice 6061-T6's yield strength, but it gives up that strength at a lower temperature.
- Not weldable by ordinary fusion welding; the sandbox does not model joining.

### Titanium Ti-6Al-4V — Ti-6Al-4V (Grade 5), annealed

`titanium-6al4v` · structural-metal · Strong, light and a poor conductor of heat: supports that must not carry heat.

| Property                    | Value                                                                 | Conditions | Source          | Confidence  | Note                                                                |
| --------------------------- | --------------------------------------------------------------------- | ---------- | --------------- | ----------- | ------------------------------------------------------------------- |
| Density                     | 4430 kg/m³                                                            |            | `asm-datasheet` | typical     |                                                                     |
| Yield strength (0.2 %)      | 880 MPa (range 828 MPa – 950 MPa)                                     |            | `asm-datasheet` | typical     | Typical annealed; ASTM B265 specifies 828 MPa minimum.              |
| Ultimate / tensile strength | 950 MPa                                                               |            | `asm-datasheet` | typical     |                                                                     |
| Young's modulus             | 113.8 GPa                                                             |            | `asm-datasheet` | typical     |                                                                     |
| Poisson's ratio             | 0.342                                                                 |            | `asm-datasheet` | typical     |                                                                     |
| Specific heat               | 526 J/(kg·K)                                                          |            | `asm-datasheet` | typical     |                                                                     |
| Thermal conductivity        | 6.7 W/(m·K)                                                           |            | `asm-datasheet` | typical     |                                                                     |
| Expansion coefficient       | 8.6e-6 1/K                                                            | 20–100 °C  | `asm-datasheet` | typical     |                                                                     |
| Melting (solidus)           | 1877.15 K (1604 °C) (range 1877.15 K (1604 °C) – 1933.15 K (1660 °C)) |            | `asm-datasheet` | typical     |                                                                     |
| Max. service temperature    | 673.15 K (400 °C)                                                     |            | `asm-datasheet` | approximate | Commonly quoted maximum service temperature for strength retention. |
| Electrical resistivity      | 1.78e-6 Ω·m                                                           |            | `asm-datasheet` | typical     |                                                                     |
| Magnetic                    | not ferromagnetic                                                     |            |                 |             |                                                                     |

- Thermal conductivity is a fortieth of copper's: good for supports between cold and warm parts.
- Titanium shows oxide temper colours (straw to blue) when heated in air, like steel.

### Copper OFHC — C10100 oxygen-free electronic copper, annealed

`copper-ofhc` · conductor · Superconducting-cable stabiliser and high-purity conductors.

| Property                    | Value                 | Conditions | Source          | Confidence | Note                                                                                                                                                                                   |
| --------------------------- | --------------------- | ---------- | --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density                     | 8940 kg/m³            |            | `asm-datasheet` | typical    |                                                                                                                                                                                        |
| Yield strength (0.2 %)      | 69 MPa                |            | `asm-datasheet` | typical    | Annealed.                                                                                                                                                                              |
| Ultimate / tensile strength | 221 MPa               |            | `asm-datasheet` | typical    |                                                                                                                                                                                        |
| Young's modulus             | 115 GPa               |            | `asm-datasheet` | typical    |                                                                                                                                                                                        |
| Specific heat               | 385 J/(kg·K)          |            | `crc`           | handbook   |                                                                                                                                                                                        |
| Thermal conductivity        | 391 W/(m·K)           | 20 °C      | `asm-datasheet` | typical    |                                                                                                                                                                                        |
| Expansion coefficient       | 1.7e-5 1/K            | 20–100 °C  | `asm-datasheet` | typical    |                                                                                                                                                                                        |
| Melting (solidus)           | 1357.77 K (1084.6 °C) |            | `crc`           | handbook   |                                                                                                                                                                                        |
| Max. service temperature    | 473.15 K (200 °C)     |            | `asm-datasheet` | typical    | Softening limit for worked tempers.                                                                                                                                                    |
| Electrical resistivity      | 1.707e-8 Ω·m          |            | `astm-b170`     | specified  | 101 % IACS minimum: 1.7241e-8 ÷ 1.01.                                                                                                                                                  |
| Resistivity ρ(T)            | 11 points, 100–900 K  |            | `crc`           | handbook   | Pure annealed copper. Below ~100 K the value depends on purity (residual resistance ratio) and is not tabulated here; above 900 K it is held at the 900 K value, which understates it. |
| Magnetic                    | not ferromagnetic     |            |                 |            |                                                                                                                                                                                        |

- Its value in a magnet is at 4 K, where purity sets the resistivity (the residual resistance ratio, typically 100–300 for OFHC). That low-temperature resistivity is grade- and strain-dependent and not catalogued.

### Aluminum 1350 conductor — 1350-H19 electrical-conductor aluminium

`aluminum-1350` · conductor · Overhead-line and busbar aluminium: half copper's conductivity at a third the mass.

| Property               | Value                                                           | Conditions | Source          | Confidence | Note                                    |
| ---------------------- | --------------------------------------------------------------- | ---------- | --------------- | ---------- | --------------------------------------- |
| Density                | 2705 kg/m³                                                      |            | `asm-datasheet` | typical    |                                         |
| Young's modulus        | 69 GPa                                                          |            | `asm-datasheet` | typical    |                                         |
| Specific heat          | 900 J/(kg·K)                                                    |            | `asm-datasheet` | typical    |                                         |
| Thermal conductivity   | 234 W/(m·K)                                                     |            | `asm-datasheet` | typical    |                                         |
| Melting (solidus)      | 919.15 K (646 °C) (range 919.15 K (646 °C) – 930.15 K (657 °C)) |            | `asm-datasheet` | typical    |                                         |
| Electrical resistivity | 2.826e-8 Ω·m                                                    |            | `astm-b230`     | specified  | 61.0 % IACS minimum: 1.7241e-8 ÷ 0.610. |
| Magnetic               | not ferromagnetic                                               |            |                 |            |                                         |

- Reference data only: its yield strength depends strongly on wire temper and is not catalogued, so it cannot be assigned to a load-bearing part.

### Molybdenum — Pure molybdenum (≥ 99.95 %), stress-relieved

`molybdenum` · plasma-facing · Refractory metal for hot structures and limiters.

| Property                 | Value                                       | Conditions | Source               | Confidence  | Note                                                               |
| ------------------------ | ------------------------------------------- | ---------- | -------------------- | ----------- | ------------------------------------------------------------------ |
| Density                  | 10280 kg/m³                                 |            | `crc`                | handbook    |                                                                    |
| Yield strength (0.2 %)   | 550 MPa (range 550 MPa – 800 MPa)           |            | `supplier-datasheet` | approximate | Process-dependent like tungsten; the low end is used.              |
| Young's modulus          | 329 GPa                                     |            | `crc`                | handbook    |                                                                    |
| Specific heat            | 251 J/(kg·K)                                |            | `crc`                | handbook    | 24.06 J/(mol·K) ÷ 95.95 g/mol.                                     |
| Thermal conductivity     | 138 W/(m·K)                                 | 300 K      | `crc`                | handbook    |                                                                    |
| Expansion coefficient    | 4.8e-6 1/K                                  | 25 °C      | `crc`                | handbook    |                                                                    |
| Melting (solidus)        | 2896 K (2622.8 °C)                          |            | `crc`                | handbook    | 2623 °C.                                                           |
| Max. service temperature | 1373.15 K (1100 °C)                         |            | `supplier-datasheet` | approximate | Approximate recrystallisation onset (vacuum); embrittles above it. |
| Electrical resistivity   | 5.34e-8 Ω·m (range 5.3e-8 Ω·m – 5.5e-8 Ω·m) | 20 °C      | `crc`                | approximate |                                                                    |
| Magnetic                 | not ferromagnetic                           |            |                      |             |                                                                    |

- Oxidises rapidly in air above ~500 °C (volatile MoO3); the service limit assumes vacuum.
- High melting point and conductivity; used for limiters and in devices such as Alcator C-Mod.
- Like tungsten, high-Z: impurities in the plasma radiate strongly.

### Beryllium — Materion S-65 hot-isostatically-pressed beryllium

`beryllium` · plasma-facing · Low-Z first-wall armour (JET, ITER) and a blanket neutron multiplier.

| Property                    | Value              | Conditions | Source         | Confidence | Note          |
| --------------------------- | ------------------ | ---------- | -------------- | ---------- | ------------- |
| Density                     | 1850 kg/m³         |            | `crc`          | handbook   | 1.848 g/cm³.  |
| Yield strength (0.2 %)      | 207 MPa            |            | `materion-s65` | specified  | S-65 minimum. |
| Ultimate / tensile strength | 345 MPa            |            | `materion-s65` | specified  |               |
| Young's modulus             | 287 GPa            |            | `crc`          | handbook   |               |
| Specific heat               | 1825 J/(kg·K)      |            | `crc`          | handbook   |               |
| Thermal conductivity        | 200 W/(m·K)        | 300 K      | `crc`          | handbook   |               |
| Expansion coefficient       | 1.13e-5 1/K        | 25 °C      | `crc`          | handbook   |               |
| Melting (solidus)           | 1560 K (1286.8 °C) |            | `crc`          | handbook   | 1287 °C.      |
| Magnetic                    | not ferromagnetic  |            |                |            |               |

- Reference data only: its electrical resistivity and service limit are not catalogued yet, so it cannot be assigned to a placed part.
- A neutron multiplier: a fast neutron can knock two out of a beryllium nucleus, which helps a blanket breed more than one triton per fusion neutron.
- Beryllium dust is toxic (chronic beryllium disease); handling requires containment.
- Low atomic number: eroded beryllium radiates little in the plasma, but its melting point is less than half of tungsten's.

### Graphite — Toyo Tanso IG-110 isotropic nuclear graphite

`graphite-ig110` · plasma-facing · Carbon armour tiles and moderator blocks. It does not melt — it sublimes.

| Property                    | Value                                                           | Conditions       | Source             | Confidence  | Note                                                                                                         |
| --------------------------- | --------------------------------------------------------------- | ---------------- | ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Density                     | 1770 kg/m³                                                      |                  | `toyo-tanso-ig110` | typical     |                                                                                                              |
| Ultimate / tensile strength | 25 MPa                                                          |                  | `toyo-tanso-ig110` | typical     | Tensile strength.                                                                                            |
| Young's modulus             | 9.8 GPa                                                         |                  | `toyo-tanso-ig110` | typical     |                                                                                                              |
| Flexural strength           | 39 MPa                                                          |                  | `toyo-tanso-ig110` | typical     |                                                                                                              |
| Compressive strength        | 78 MPa                                                          |                  | `toyo-tanso-ig110` | typical     |                                                                                                              |
| Specific heat               | 710 J/(kg·K)                                                    | room temperature | `crc`              | handbook    |                                                                                                              |
| Thermal conductivity        | 120 W/(m·K)                                                     |                  | `toyo-tanso-ig110` | typical     |                                                                                                              |
| Expansion coefficient       | 3.9e-6 1/K                                                      |                  | `toyo-tanso-ig110` | typical     |                                                                                                              |
| Sublimation / decomposition | 3900 K (3626.8 °C)                                              |                  | `crc`              | approximate | Sublimes at about 3900 K at atmospheric pressure; it has no liquid phase at 1 atm.                           |
| Electrical resistivity      | 1.1e-5 Ω·m                                                      |                  | `toyo-tanso-ig110` | typical     |                                                                                                              |
| Magnetic                    | not ferromagnetic                                               |                  |                    |             |                                                                                                              |
| Ignition (combustible)      | 673.15 K (400 °C) (range 673.15 K (400 °C) – 873.15 K (600 °C)) |                  | `crc`              | approximate | Graphite oxidises in air from roughly 400–600 °C and can sustain burning when hot; it cannot burn in vacuum. |

- Brittle: it fails in tension and bending at a small fraction of a metal's strength.
- Reference data only: a brittle material does not fit the structural solver's yield model.
- Cannot melt, so it survives heat pulses that would melt metal armour, but it erodes chemically in hydrogen plasma and traps tritium in the redeposited carbon.

### Silicon Carbide — High-purity CVD β-SiC (monolithic)

`sic-cvd` · plasma-facing · Low-activation ceramic for hot blanket structures and SiC/SiC composites.

| Property                    | Value                                         | Conditions        | Source              | Confidence  | Note                                                       |
| --------------------------- | --------------------------------------------- | ----------------- | ------------------- | ----------- | ---------------------------------------------------------- |
| Density                     | 3210 kg/m³                                    |                   | `cvd-sic-datasheet` | typical     |                                                            |
| Young's modulus             | 466 GPa                                       |                   | `cvd-sic-datasheet` | typical     |                                                            |
| Flexural strength           | 470 MPa (range 400 MPa – 600 MPa)             |                   | `cvd-sic-datasheet` | approximate |                                                            |
| Specific heat               | 640 J/(kg·K)                                  |                   | `cvd-sic-datasheet` | typical     |                                                            |
| Thermal conductivity        | 300 W/(m·K) (range 250 W/(m·K) – 330 W/(m·K)) |                   | `cvd-sic-datasheet` | approximate | High-purity CVD grades; irradiation lowers it severalfold. |
| Expansion coefficient       | 4e-6 1/K                                      | 20–1000 °C (mean) | `cvd-sic-datasheet` | approximate |                                                            |
| Sublimation / decomposition | 3003.15 K (2730 °C)                           |                   | `crc`               | approximate | Decomposes rather than melting at atmospheric pressure.    |
| Magnetic                    | not ferromagnetic                             |                   |                     |             |                                                            |

- Brittle ceramic: strength is statistical and flaw-dependent.
- Reference data only: brittle fracture is not modelled by the structural solver.
- SiC/SiC composites differ substantially from monolithic SiC and are not catalogued yet.
- Low induced activity; SiC fibre-reinforced SiC composites are a candidate structural material for advanced blankets.

### Niobium–Titanium — Nb-47 wt% Ti superconductor alloy

`nbti` · superconductor · The workhorse superconductor (MRI, LHC, ITER poloidal coils) — up to ~10 T at 4 K.

| Property         | Value                   | Conditions | Source         | Confidence  | Note                                                                                 |
| ---------------- | ----------------------- | ---------- | -------------- | ----------- | ------------------------------------------------------------------------------------ |
| Density          | 6020 kg/m³              |            | `derived`      | approximate | Ideal-mixture estimate from elemental densities: 1/ρ = 0.53/8.57 + 0.47/4.506 g/cm³. |
| Tc0              | 9.2 K (-263.9 °C)       |            | `bottura-2000` | handbook    |                                                                                      |
| Bc20             | 14.5 T                  |            | `bottura-2000` | handbook    |                                                                                      |
| Critical surface | lubell-bottura, n = 1.7 |            |                |             | Bc2(T) = Bc20(1 − t^1.7) after Lubell (1983). At 5 T Tc ≈ 7.2 K; at 9 T ≈ 5.3 K.     |

- Only the superconducting critical surface and density are catalogued; NbTi is used here as the conductor region of finished magnets, never as a structural member.
- The critical temperature falls with field: at 5 T, Tc ≈ 7.2 K; at 9 T, Tc ≈ 5.3 K.

### Niobium–Tin — Nb₃Sn A15 superconductor (optimal composition, unstrained)

`nb3sn` · superconductor · High-field superconductor (ITER toroidal-field and central-solenoid coils).

| Property         | Value                    | Conditions | Source        | Confidence  | Note                                                                                                              |
| ---------------- | ------------------------ | ---------- | ------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Density          | 8920 kg/m³               |            | `derived`     | approximate | From the A15 cell: 6 Nb + 2 Sn (794.9 g/mol) in a = 5.29 Å.                                                       |
| Tc0              | 18 K (-255.1 °C)         |            | `godeke-2006` | approximate | Optimal, unstrained A15; practical wires reach ~16–18 K.                                                          |
| Bc20             | 30 T (range 28 T – 30 T) |            | `godeke-2006` | approximate | Unstrained; compressive strain in a cable lowers it by several tesla.                                             |
| Critical surface | godeke, n = 1.52         |            |               |             | Bc2(T) = Bc2(0)(1 − t^1.52) (Godeke 2006). Strain dependence is not modelled: this is the unstrained upper bound. |

- Brittle intermetallic formed by heat treatment after winding; strain in the finished cable reduces Tc and Bc2.
- At 12 T the unstrained critical temperature is about 12 K.

### REBCO — REBa₂Cu₃O₇₋δ (YBCO-class) coated-conductor superconducting layer

`rebco` · superconductor · High-temperature superconductor tape for compact high-field magnets.

| Property         | Value                                                        | Conditions | Source    | Confidence  | Note                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------ | ---------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density          | 6380 kg/m³                                                   |            | `derived` | approximate | Theoretical (X-ray) density of YBa₂Cu₃O₇.                                                                                                                                             |
| Tc0              | 92 K (-181.1 °C) (range 90 K (-183.1 °C) – 93 K (-180.1 °C)) |            | `wu-1987` | handbook    |                                                                                                                                                                                       |
| Critical surface | not catalogued                                               |            |           |             | Its upper critical field exceeds 100 T at low temperature and is strongly anisotropic; a field-dependent critical surface is not catalogued, so REBCO is reference data only for now. |

- A real tape is mostly Hastelloy substrate and copper; the superconducting layer is a few micrometres thick.

### Magnesium Diboride — MgB₂

`mgb2` · superconductor · Low-cost intermediate-temperature superconductor (≈20 K operation).

| Property         | Value            | Conditions | Source           | Confidence  | Note                                                                               |
| ---------------- | ---------------- | ---------- | ---------------- | ----------- | ---------------------------------------------------------------------------------- |
| Density          | 2620 kg/m³       |            | `derived`        | approximate | From the hexagonal cell: a = 3.086 Å, c = 3.524 Å, one formula unit (45.93 g/mol). |
| Tc0              | 39 K (-234.1 °C) |            | `nagamatsu-2001` | handbook    |                                                                                    |
| Critical surface | not catalogued   |            |                  |             | Field dependence depends strongly on doping and processing; not catalogued.        |

- Reference data only: no critical surface catalogued.

### G-10CR Fiberglass Epoxy — NEMA G-10CR woven glass / epoxy laminate (cryogenic grade)

`g10-cr` · insulator-ceramic · Magnet ground insulation and cryogenic supports.

| Property                 | Value                                                           | Conditions              | Source               | Confidence  | Note                                                                                                                     |
| ------------------------ | --------------------------------------------------------------- | ----------------------- | -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Density                  | 1800 kg/m³ (range 1700 kg/m³ – 1900 kg/m³)                      |                         | `supplier-datasheet` | typical     |                                                                                                                          |
| Specific heat            | 999 J/(kg·K)                                                    | 300 K                   | `nist-cryo`          | handbook    | 2.8 J/(kg·K) at 4.5 K.                                                                                                   |
| Thermal conductivity     | 0.61 W/(m·K)                                                    | 300 K, normal direction | `nist-cryo`          | handbook    | 0.08 W/(m·K) at 4.5 K.                                                                                                   |
| Max. service temperature | 403.15 K (130 °C)                                               |                         | `supplier-datasheet` | approximate | Epoxy-glass laminates of this class are rated for continuous use around 130 °C; above it the resin softens and degrades. |
| Electrical               | insulator                                                       |                         |                      |             |                                                                                                                          |
| Ignition (combustible)   | 673.15 K (400 °C) (range 623.15 K (350 °C) – 723.15 K (450 °C)) |                         | `polymer-handbook`   | approximate | Epoxy resin decomposes and can burn from roughly 350–450 °C; the glass does not burn.                                    |

- Specific heat 999 J/(kg·K) and normal-direction conductivity 0.61 W/(m·K) are the NIST G-10CR fits evaluated at 300 K (2 % and 5 % fit error).
- Density: specific gravity 1.8 (Atlas Fibre G10 datasheet); other suppliers quote 1.70–1.90.
- At 4.5 K the NIST fits give 2.8 J/(kg·K) and 0.08 W/(m·K): insulation is a thermal barrier in a magnet.

### Alumina — 99.5 % aluminium oxide (CoorsTek AD-995)

`alumina` · insulator-ceramic · Feedthroughs, bushings and high-voltage insulators.

| Property                 | Value               | Conditions | Source           | Confidence | Note                                     |
| ------------------------ | ------------------- | ---------- | ---------------- | ---------- | ---------------------------------------- |
| Density                  | 3900 kg/m³          |            | `coorstek-ad995` | typical    |                                          |
| Young's modulus          | 370 GPa             |            | `coorstek-ad995` | typical    |                                          |
| Flexural strength        | 375 MPa             |            | `coorstek-ad995` | typical    |                                          |
| Compressive strength     | 2.6 GPa             |            | `coorstek-ad995` | typical    |                                          |
| Specific heat            | 880 J/(kg·K)        |            | `coorstek-ad995` | typical    |                                          |
| Thermal conductivity     | 35 W/(m·K)          | 20 °C      | `coorstek-ad995` | typical    |                                          |
| Expansion coefficient    | 8.2e-6 1/K          | 25–1000 °C | `coorstek-ad995` | typical    |                                          |
| Melting (solidus)        | 2345 K (2071.8 °C)  |            | `crc`            | handbook   | 2072 °C.                                 |
| Max. service temperature | 1973.15 K (1700 °C) |            | `coorstek-ad995` | typical    |                                          |
| Electrical resistivity   | 1e+12 Ω·m           |            | `coorstek-ad995` | typical    | Volume resistivity > 10¹⁴ Ω·cm at 25 °C. |
| Dielectric strength      | 8.7 kV/mm           |            | `coorstek-ad995` | typical    | Thickness-dependent.                     |
| Magnetic                 | not ferromagnetic   |            |                  |            |                                          |

- Brittle: cracks under thermal shock rather than yielding.

### Polyimide (Kapton HN) — DuPont Kapton HN polyimide film

`kapton` · insulator-ceramic · Turn insulation and cryogenic electrical insulation.

| Property                    | Value             | Conditions | Source             | Confidence | Note                          |
| --------------------------- | ----------------- | ---------- | ------------------ | ---------- | ----------------------------- |
| Density                     | 1420 kg/m³        |            | `dupont-kapton-hn` | typical    |                               |
| Ultimate / tensile strength | 231 MPa           |            | `dupont-kapton-hn` | typical    |                               |
| Young's modulus             | 2.5 GPa           |            | `dupont-kapton-hn` | typical    |                               |
| Specific heat               | 1090 J/(kg·K)     |            | `dupont-kapton-hn` | typical    |                               |
| Thermal conductivity        | 0.12 W/(m·K)      |            | `dupont-kapton-hn` | typical    |                               |
| Max. service temperature    | 673.15 K (400 °C) |            | `dupont-kapton-hn` | typical    | Rated from −269 °C to 400 °C. |
| Min. service temperature    | 4 K (-269.1 °C)   |            | `dupont-kapton-hn` | typical    |                               |
| Electrical resistivity      | 1.5e+15 Ω·m       |            | `dupont-kapton-hn` | typical    |                               |
| Dielectric strength         | 303 kV/mm         | 25 µm film | `dupont-kapton-hn` | typical    |                               |

- Flame-retardant (UL 94 V-0): it chars rather than sustaining a flame, so it is not counted as combustible.

### XLPE cable insulation — Cross-linked polyethylene power-cable insulation

`xlpe` · insulator-ceramic · Power-cable insulation — and the main fire load in an electrical gallery.

| Property                 | Value                                                           | Conditions  | Source             | Confidence  | Note                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------- | ----------- | ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Density                  | 920 kg/m³ (range 910 kg/m³ – 940 kg/m³)                         |             | `polymer-handbook` | typical     |                                                                                                                                                     |
| Max. service temperature | 363.15 K (90 °C)                                                |             | `iec-60502`        | specified   | Maximum conductor temperature in normal operation.                                                                                                  |
| Electrical               | insulator                                                       |             |                    |             |                                                                                                                                                     |
| Ignition (combustible)   | 623.15 K (350 °C) (range 603.15 K (330 °C) – 683.15 K (410 °C)) |             | `polymer-handbook` | approximate | Autoignition range quoted for polyethylene; heat of combustion ≈ 46 MJ/kg.                                                                          |
| Heat of combustion       | 43.3 MJ/kg (range 38.4 – 46.5 MJ/kg)                            | in a fire   | `polymer-handbook` | approximate | Effective value (SFPE Handbook tabulations); complete combustion ≈ 46 MJ/kg, chemical heat of a sooty flame ≈ 38 MJ/kg. XLPE taken as polyethylene. |
| Free-burning rate        | 0.026 kg/(m²·s) (range 0.014 – 0.026)                           | large-scale | `polymer-handbook` | approximate | Asymptotic large-scale mass flux of polyethylene (SFPE Handbook); smaller or vertical samples burn more slowly.                                     |

- IEC 60502 allows 250 °C for at most 5 s during a short circuit; beyond that the insulation is damaged.
- Polyethylene burns with heavy black smoke.
- Heat of combustion and burning rate are what the simulation burns it with (docs/HAZARDS.md). Its specific heat, conductivity, critical heat flux and ignition-response parameter are not yet sourced and are left missing; graphite and G-10 ignite but have no sourced burning data, so the model reports them above ignition without burning them.

### Concrete — Normal-weight concrete, strength class C30/37

`concrete-c30` · civil · Floors, foundations and the biological shield around a reactor.

| Property             | Value                                            | Conditions     | Source   | Confidence | Note                                                                       |
| -------------------- | ------------------------------------------------ | -------------- | -------- | ---------- | -------------------------------------------------------------------------- |
| Density              | 2400 kg/m³                                       |                | `en1992` | specified  | EN 1991-1-1 plain normal-weight concrete (24 kN/m³); 2500 when reinforced. |
| Young's modulus      | 33 GPa                                           |                | `en1992` | specified  | Secant modulus Ecm.                                                        |
| Compressive strength | 30 MPa                                           |                | `en1992` | specified  | Characteristic cylinder strength fck.                                      |
| Specific heat        | 900 J/(kg·K)                                     | 20–100 °C, dry | `en1992` | specified  |                                                                            |
| Thermal conductivity | 1.36 W/(m·K) (range 1.36 W/(m·K) – 1.95 W/(m·K)) | 20 °C          | `en1992` | specified  | EN 1992-1-2 lower and upper limits.                                        |

- Reference data only: concrete is strong in compression and weak in tension, which the structural solver does not distinguish.
- Its hydrogen (in bound water) slows neutrons and its mass stops gamma rays: the standard biological shield.

## Fluids

### Water (H₂O)

`water` · Coolant, steam-cycle working fluid and shielding. Release looks like: steam.

| Property                                      | Value                | Conditions | Source  | Confidence | Note     |
| --------------------------------------------- | -------------------- | ---------- | ------- | ---------- | -------- |
| Molar mass                                    | 18.015 g/mol         |            | `iapws` | handbook   |          |
| Normal boiling point                          | 373.124 K (100 °C)   |            | `iapws` | handbook   |          |
| Triple point                                  | 273.16 K (0 °C)      |            | `iapws` | handbook   |          |
| Critical temperature                          | 647.096 K (373.9 °C) |            | `iapws` | handbook   |          |
| Critical pressure                             | 22.06 MPa            |            | `iapws` | handbook   |          |
| Latent heat of vaporisation                   | 2.256e+6 J/kg        | 100 °C     | `iapws` | handbook   |          |
| Density — 20 °C, 1 atm                        | 998.21 kg/m³         |            | `iapws` | handbook   |          |
| Specific heat — 20 °C, 1 atm                  | 4182 J/(kg·K)        |            | `iapws` | handbook   |          |
| Conductivity — 20 °C, 1 atm                   | 0.598 W/(m·K)        |            | `iapws` | handbook   |          |
| Viscosity — 20 °C, 1 atm                      | 0.001002 Pa·s        |            | `iapws` | handbook   |          |
| Density — PWR primary: 15.5 MPa, 300 °C       | 725.5 kg/m³          |            | `iapws` | handbook   | Rounded. |
| Specific heat — PWR primary: 15.5 MPa, 300 °C | 5475 J/(kg·K)        |            | `iapws` | handbook   | Rounded. |
| Viscosity — PWR primary: 15.5 MPa, 300 °C     | 9e-5 Pa·s            |            | `iapws` | handbook   | Rounded. |

- At 15.5 MPa water boils at 344.8 °C (617.9 K); a PWR keeps its primary subcooled below that.
- Pressurised water escaping to atmosphere partly flashes to steam: the visible white plume is condensed droplets, the steam itself is invisible.

### Helium (He)

`helium` · Gas coolant for hot blankets and the cryogen of superconducting magnets. Release looks like: cryogenic-vapor.

| Property                                            | Value               | Conditions | Source         | Confidence  | Note                                                         |
| --------------------------------------------------- | ------------------- | ---------- | -------------- | ----------- | ------------------------------------------------------------ |
| Molar mass                                          | 4.0026 g/mol        |            | `nist-webbook` | handbook    |                                                              |
| Normal boiling point                                | 4.222 K (-268.9 °C) |            | `nist-webbook` | handbook    |                                                              |
| Critical temperature                                | 5.1953 K (-268 °C)  |            | `nist-webbook` | handbook    |                                                              |
| Critical pressure                                   | 2.275e+5 Pa         |            | `nist-webbook` | handbook    |                                                              |
| Latent heat of vaporisation                         | 20700 J/kg          | 4.222 K    | `derived`      | handbook    | 0.0829 kJ/mol ÷ 4.0026 g/mol.                                |
| Density — DEMO blanket coolant: 8 MPa, 400 °C       | 5.72 kg/m³          |            | `derived`      | approximate | Ideal gas: ρ = pM / RT = 8e6 × 0.0040026 / (8.314 × 673.15). |
| Specific heat — DEMO blanket coolant: 8 MPa, 400 °C | 5193 J/(kg·K)       |            | `derived`      | handbook    | Monatomic ideal gas, 5/2 R / M.                              |
| Viscosity — DEMO blanket coolant: 8 MPa, 400 °C     | 3.5e-5 Pa·s         | ≈ 673 K    | `nist-webbook` | approximate |                                                              |
| Density — Saturated liquid at 1 atm                 | 125 kg/m³           |            | `nist-webbook` | handbook    |                                                              |

- Liquid helium boiling to room-temperature gas expands about 750-fold (125 kg/m³ to 0.166 kg/m³ at 20 °C, 1 atm): a magnet quench vents it violently through relief lines.
- Cold helium vapour is denser than air and condenses atmospheric moisture into a white fog that falls before the warming gas rises.
- Helium is inert and colourless; in a closed room it displaces oxygen.

### Deuterium (D₂)

`deuterium` · Fusion fuel, stable isotope of hydrogen. Release looks like: invisible-gas.

| Property             | Value                | Conditions | Source         | Confidence | Note                                                            |
| -------------------- | -------------------- | ---------- | -------------- | ---------- | --------------------------------------------------------------- |
| Molar mass           | 4.0282 g/mol         |            | `nist-webbook` | handbook   |                                                                 |
| Triple point         | 18.724 K (-254.4 °C) |            | `nist-webbook` | handbook   | Normal deuterium.                                               |
| Critical temperature | 38.34 K (-234.8 °C)  |            | `nist-webbook` | handbook   |                                                                 |
| Critical pressure    | 1.665 MPa            |            | `nist-webbook` | handbook   |                                                                 |
| Combustible          | yes                  |            |                |            | A flammable gas like hydrogen, from about 4 % by volume in air. |

- In a vacuum vessel there is no oxygen: fuel does not burn, it fuses or is pumped away.

### Tritium (T₂)

`tritium` · Radioactive fusion fuel, bred from lithium in the blanket. Release looks like: invisible-gas.

| Property          | Value          | Conditions | Source        | Confidence | Note                                                               |
| ----------------- | -------------- | ---------- | ------------- | ---------- | ------------------------------------------------------------------ |
| Molar mass        | 6.032 g/mol    |            | `crc`         | handbook   |                                                                    |
| Half-life         | 3.888e+8 s     |            | `nubase-2020` | handbook   | 12.32 years.                                                       |
| Specific activity | 3.56e+17 Bq/kg |            | `derived`     | handbook   | λ N_A / M with λ = ln 2 / T½ (≈ 3.6 × 10¹⁴ Bq per gram).           |
| Decay heat        | 324.53 W/kg    |            | `derived`     | handbook   | Specific activity × mean beta energy 5.69 keV (≈ 0.32 W per gram). |
| Combustible       | yes            |            |               |            | Flammable like hydrogen.                                           |

- A weak beta emitter: the electrons do not penetrate skin, but tritium taken into the body (as tritiated water) is a radiological hazard.
- Its decay heat warms stored tritium measurably, a few tenths of a watt per gram.

### D-T fuel mixture (D + T (50:50))

`dt-fuel` · The fuel of every power-plant tokamak design. Release looks like: invisible-gas.

| Property               | Value          | Conditions | Source    | Confidence | Note                                                                                     |
| ---------------------- | -------------- | ---------- | --------- | ---------- | ---------------------------------------------------------------------------------------- |
| Specific energy (fuel) | 3.374e+14 J/kg |            | `derived` | handbook   | 17.59 MeV per reaction ÷ (2.014 + 3.016) u of fuel consumed (fusion-physics energetics). |

- D + T → ⁴He (3.52 MeV) + n (14.07 MeV), 17.59 MeV per reaction: about 3.4 × 10¹⁴ J per kilogram of fuel burned.
- A tokamak holds about a gram of fuel in the plasma at any moment; a fault extinguishes it rather than releasing its fusion energy.

### Lithium-lead eutectic (Li₁₇Pb₈₃)

`lithium-lead` · Liquid-metal breeder and coolant for tritium-breeding blankets. Release looks like: liquid-metal.

| Property                             | Value             | Conditions | Source                  | Confidence  | Note                                                                                                     |
| ------------------------------------ | ----------------- | ---------- | ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| Melting point                        | 508.15 K (235 °C) |            | `mas-de-les-valls-2008` | approximate | Recent assessments place the eutectic nearer 15.7 at.% Li; the melting point is about 235 °C either way. |
| Density — Blanket conditions, 500 °C | 9599.9 kg/m³      |            | `mas-de-les-valls-2008` | approximate | ρ = 10520.35 − 1.19051·T (K).                                                                            |

- Breeds tritium by ⁶Li + n → T + ⁴He (4.78 MeV); the lead multiplies neutrons and shields.
- Electrically conducting: flowing across a strong magnetic field it suffers large MHD pressure drops (not modelled).

### Transformer oil (Mineral insulating oil)

`mineral-oil` · Insulating coolant in power transformers — the fire load of a switchyard. Release looks like: liquid-spray.

| Property        | Value                                   | Conditions | Source      | Confidence  | Note                                                                                 |
| --------------- | --------------------------------------- | ---------- | ----------- | ----------- | ------------------------------------------------------------------------------------ |
| Density — 20 °C | 880 kg/m³ (range 830 kg/m³ – 895 kg/m³) |            | `iec-60296` | approximate | IEC 60296 sets a maximum of 895 kg/m³ at 20 °C; typical oils are 860–890.            |
| Flash point     | 408.15 K (135 °C)                       |            | `iec-60296` | specified   | Minimum flash point.                                                                 |
| Combustible     | yes                                     |            |             |             | Burns once heated past its flash point and ignited — the fire load of a transformer. |

- An internal arc in an oil-filled transformer decomposes the oil into gas, pressurising the tank; tank rupture and oil fire are the classic transformer failure.

---

## Adding or changing a value

1. Name the grade. A property without a grade is not data.
2. Add the source to `sources.ts` if it is new, give the value its unit, conditions,
   confidence and spread in `library.ts`, and record what the number means here.
3. Put the caveats in the material's `notes` array in code, not only here — the workspace
   shows them, and a player reading a number deserves to see what it excludes.
4. Never round a number to make a scenario work. If a structure fails, that is the answer.

`packages/materials/src/materials.test.ts` asserts that every structural material stays
within physically plausible magnitudes for an engineering metal, that every number in the
library has a known source, a unit and a confidence, that curves are ordered, that the
original five materials keep their exact values, and that no metal is marked combustible. It cannot check that a number is
_correct_ — that is what this document is for.
