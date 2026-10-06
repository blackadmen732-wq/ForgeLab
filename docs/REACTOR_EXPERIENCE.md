# ForgeLab Interactive Reactor Experience — plan

**Goal:** a new player can enter the reactor hall → place finished machines → connect them
→ activate the plant → see and hear plasma operation → experience an explainable failure
→ inspect the cause → change the design → run it again.

## Starting point (inspected)

| Area                 | Already there                                                                                                                                                                                                                                                                          | Missing for the slice                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sim-core`           | structural statics; plant solver (`plant/solver.ts`): DC electrical islands, lumped thermal, coolant loops with pump head vs. pressure drop, vacuum pump-down, magnets with quench and hoop stress, 0D tokamak plasma (IPB98), Bosch–Hale D-T; causal failure chains; model confidence | a staged commissioning sequence; typed port ratings and compatibility; a cryogenic network (cryo capacity is internal to each coil today)               |
| `reactor-components` | 21 parametric parts (one material each), reference plant, interactive starter                                                                                                                                                                                                          | product data: internals and material regions, ratings, failure modes, audio/visual profiles; cryoplant, magnet power supply, valve, protection computer |
| `materials`          | 5 sourced materials, room-temperature scalars                                                                                                                                                                                                                                          | optional property groups (superconducting, cryogenic, nuclear) and the materials the internals need                                                     |
| `apps/web` builder   | R3F viewport on an infinite grid; drawer, inspector and timeline always open; overlays (material, stress, temperature, power, coolant, magnetic, plasma); cutaway; timeline with failures and "Why?"                                                                                   | the hall; a clean fullscreen shell; ACTIVATE; audio; port-to-port connection; internals view; rewind to cause; run report and personal best             |
| collaboration        | channels, voice, chat, presence, roles, shared saves                                                                                                                                                                                                                                   | untouched this milestone                                                                                                                                |

## Rules kept

- `sim-core` is the only authority on physical truth. Environment, audio, overlays and
  camera read state; nothing they do reaches the simulation or the save file.
- Materials describe substances; product definitions (in `reactor-components`) describe
  machines made of them; sim-core roles describe physics.
- Magnetic fields, neutrons, gravity and radiation stay spatial interactions — never ports.
- The architecture tests (`sim-core/src/architecture.test.ts`,
  `protocol/src/boundaries.test.ts`) stay green; every commit keeps `pnpm verify`,
  the acceptance test and the collaboration test passing.

## Work, in order

1. **Hall** — `apps/web/src/builder/scene/environment/`: preset registry (Industrial Hall
   built; Clean Lab, Dark Facility, Outdoor Test Site, Empty Grid prepared), stored as a
   per-user preference. Surfaces (`environment/surfaces.ts`) are procedural and seeded:
   a steel deck floor (3 × 1.5 m plates, ground seams, fixings, grime, rust and standing
   water that drives gloss), worn metal on all steelwork (world-scale box-projected UVs,
   2 m per tile) and scuffed hazard striping along trenches and walls. Metal reflects a
   hall-shaped environment map (`environment/reflections.ts`: high-bay lamps, clerestory,
   wall lights) built once on the GPU; HIGH and ULTRA add a live blurred floor mirror
   (`floorReflections` in the tier budget). None of it reaches the simulation.
2. **Shell** — drawer and inspector contextual and collapsed by default; telemetry behind
   an Engineering Overlay toggle; simulation fills the viewport with a compact HUD.
3. **Finished components** — typed port specs with domain ratings in
   `sim-core/connections.ts` (+ `portsCompatible`); product definitions with internals,
   ratings, failure modes and profiles in `reactor-components`; material property groups.
4. **Slice catalogue** — cryoplant with a cryogenic network the solver uses, magnet power
   supply, valve, protection computer; finished procedural models; a compact plant
   blueprint.
5. **Connections** — click port → compatible ports highlight → click target → routed
   cable or pipe.
6. **ACTIVATE** — commissioning stages in sim-core (electrical → cooling → cryogenics →
   vacuum → magnet ramp → fuel/heating → ignition → burn), each advanced by physical
   conditions, published in snapshots; the UI and scene react to them.
7. **Audio** — Web Audio, synthesized; consumes snapshots and failure events only.
8. **Visualization modes** — Normal, Cutaway, Temperature, Coolant, Power, Magnetic,
   Stress, Plasma, Vacuum, Neutrons; internals cutaway per component. See
   [Views](#views) below.
9. **Diagnose → fix** — rewind to the root-cause tick (deterministic re-run), highlight
   the initiating component, measured vs. limit, consequence chain, return to Build with
   it selected; run report with margins and personal best.
10. **Verify** — a browser test of the full loop; docs.

## Views

Every view colours parts from published simulation values; none of them computes physics.

| View     | Colour source                                                     | Scale                                                                                             |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Vacuum   | vessel `pressurePa`; vacuum pumps by supply and state             | log₁₀ p: red at atmosphere → amber → teal near the breakdown limit (10⁻² Pa) → blue below 10⁻⁵ Pa |
| Neutrons | `neutronHeatingW` (blanket, vessel wall and coils, from sim-core) | log₁₀ W from 1 kW (dark violet) to 1 GW (near white); unexposed parts dim                         |

In the Vacuum view everything outside the vacuum system is drawn as a ghost, so a vessel
inside its coils and blanket stays readable, and vacuum ducts are lit.

**Machine internals.** Every finished product lists its internal regions, outermost first:
each has a kind (structure, conductor, superconductor, insulation, magnetic core, coolant,
cryogen, vacuum, moving machinery, fuel, plasma-facing, breeder, sensor, electronics) and the
library material or fluid it is made of. Where the real material is not catalogued yet —
Alloy 690 steam-generator tubes, electrical-steel cores, porcelain bushings, bearing steel —
the region names it as not catalogued instead of borrowing a library material.

The major machines (coolant pump, steam generator, turbine, generator, transformer, cryopump,
neutral beam, fuel system, breaker) have schematic internal geometry built from those regions:
a pump's impeller in its volute on a shaft from the copper-wound motor, a steam generator's
tube bundle standing in its water, a generator's stator bars around its rotor. Other parts
show their regions as nested bands, sized by volume when every region has a volume fraction
and in equal steps otherwise.

**Cutaway (X)** opens every part through its own centre, removing the half that faces the
camera; the cut snaps to the part's own axes, so a generator opens along its shaft. Selected
parts show their internals in the cut. **Internal systems** (a view) does the same for every
machine with the casings ghosted, colouring regions by system — fluids blue, conductors
orange, moving machinery green (validated colours), structure, insulation, instruments and
vacuum by lightness — with a legend. Any **physics view** with Cutaway on lights only the
regions its quantity physically lives in (current in conductors, flow in coolant, field in
windings, neutron heating in plasma-facing and breeder regions) from the part's published
value: the lumped model has one value per part, and the view does not invent a
distribution inside it. Whenever internals are on screen the view says **Schematic internal
representation**: a representative arrangement, not a manufacturer's design.

## Material Lab

**M** (or More → Material Lab) opens the material library beside the 3D view: materials
grouped by engineering function, searchable by name or grade. Each material shows only the
property groups it has data for; every value carries its conditions, its confidence
(specified, handbook, typical, approximate) and its source, whose full citation appears on
hover. Tabulated temperature curves (EN 1993-1-2 strength and stiffness, copper
resistivity) are charted with a hover readout and their data table; superconductors show
their critical temperature in field. **Compare with** puts a second material's key values
side by side and overlays its curves. Materials missing a value the solvers need are marked
_Reference data_: they appear inside finished machines but cannot be assigned to a part.

In the Inspector, a part's material links to the Lab, and its **Inside** list names each
internal region's substance (opening it in the Lab). Clicking a region turns Cutaway on and
lights that region in the cross-section while the others fade.

## Showroom milestone

The presentation layer (hall, facility lighting, activation stages, audio, effects, failure
cinema) is specified in [SHOWROOM.md](SHOWROOM.md). Steps 4–6 above continue after it; the
showroom consumes today's simulation output and adds nothing to `sim-core`.
