# Material sources

Every number in `packages/materials/src/catalog.ts` is recorded here with where it came
from and what it does and does not mean. Nothing in ForgeLab's material database is a
gameplay number, and nothing was chosen to make something fail or survive.

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
creep-rupture limit, and **not** a design code allowable. Milestone 0 does not simulate
temperature at all; the field exists so that Phase 2 has somewhere honest to read from
rather than inventing values later.

**Single scalars, not curves.** Density, conductivity and resistivity all vary with
temperature; strength varies a great deal. ForgeLab stores one value per property for now.
Temperature-dependent property curves are a Phase 2 concern and are noted in the roadmap.

**Sources cited by class.** Where an entry says "ASTM A36", the figure is the value that
specification is universally quoted as setting. Where it says "CRC Handbook" or "supplier
datasheet", the figure is the conventional handbook value for the pure metal or the grade.
Where a property is strongly process-dependent, the spread is stated in the notes rather
than smoothed away.

---

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

## Adding or changing a value

1. Name the grade. A property without a grade is not data.
2. Record the source class and what the number actually means in this document, in the
   same table format, before touching `catalog.ts`.
3. Put the caveats in the material's `notes` array in code, not only here — the workspace
   shows them, and a player reading a number deserves to see what it excludes.
4. Never round a number to make a scenario work. If a structure fails, that is the answer.

`packages/materials/src/materials.test.ts` asserts that every material stays within
physically plausible magnitudes for an engineering metal and that every one of them carries
a grade, a source summary and at least one caveat. It cannot check that a number is
_correct_ — that is what this document is for.
