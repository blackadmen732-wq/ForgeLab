# ForgeLab physics roadmap

The order physics arrives in, and why that order.

Each phase is built on the one before it. The V0.1 launch candidate implements reduced,
documented versions of Phases 0–7 and parts of 8 and 9; each phase below says what exists
and what is still missing. What remains is a statement of intent, not a promise about dates.

**Ground rules, every phase.**

- No arbitrary game numbers in the physics core. Prefer documented physical relationships.
- Where reality is too expensive to compute, use an explicit, documented approximation —
  and write down what it excludes, in `docs/ARCHITECTURE.md` and next to the code.
- Every material property is sourced in `docs/material-sources.md` before it is used.
- Every subsystem ships with tests, and the tests come before the renderer.
- The simulation stays deterministic, fixed-timestep, SI, and usable without React.
- ForgeLab is never described as research-grade.

---

## Phase 0 — Gravity and structure ✅ implemented

Uniform gravity, `F = m·g` with `g = 9.80665 m/s²`. Mass derived from geometry and
material density. Support resolution over a connection graph, load accumulation, lever-rule
reaction splitting, axial stress utilization against material yield, explained failure
events, and assembly centre of mass. Semi-implicit Euler for unsupported bodies, with an
optional Rapier backend for collision.

**Phase 0.1 ✅ implemented.** Young's modulus in the material model; columns check Euler
and Johnson buckling with a global effective-length factor; beams check simply supported
or cantilever bending; axial, bending and buckling utilizations are reported separately.

**Known gaps.** Shear, torsion, lateral-torsional buckling and combined axial–bending
interaction. No elastic compatibility for indeterminate frames. No overturning. See §6 of
`ARCHITECTURE.md`.

---

## Phase 1 — Electrical circuits and power ✅ V0.1

**In V0.1:** DC nodal analysis per island, sources, loads, conductors with R = ρ(T)L/A (copper follows the CRC resistivity table, so an overloaded bus heats faster as it heats), breakers, proportional curtailment, supply-shortfall failures; an overloaded conductor keeps conducting past its service limit (over-temperature) and opens when it melts.
**Still missing:** AC, transients, fault currents, protection coordination.

Conductors, sources, loads and switches as a graph; nodal analysis for DC steady state.
Resistance from geometry and the resistivity already in the material database
(`R = ρL/A`). Resistive heating computed as a power figure, handed to Phase 2 when it
exists. Current and voltage limits produce explained electrical failure events.

_Why here:_ it is the simplest subsystem with real physics, it reuses material properties
already sourced, and nearly everything later needs power.

---

## Phase 2 — Heat and cooling ✅ V0.1

**In V0.1:** Lumped capacitance per part with specific heat, conduction along links, convection and radiation to ambient, cryogenic loads, over-temperature and quench failures.
**Temperature-dependent properties:** carbon steels (A36, A572) lose yield strength and stiffness per EN 1993-1-2 Table 3.1 at the part's lumped temperature, and structure is re-solved as they heat, so a hot support can yield or buckle; copper resistivity follows the CRC table. Materials without a sourced curve keep their room-temperature values.
**Heat through space and fire (H1):** radiant exchange between unconnected parts and fires of sourced combustibles (XLPE), with neighbours' failures attributed to the part that heated them — see `docs/HAZARDS.md`.
**Still missing:** Spatial temperature gradients (a thin combustible skin on a massive part ignites with its bulk), temperature-dependent heat capacity and conductivity, curves for stainless steels and other alloys, fire suppression, smoke and oxygen depletion.

Lumped thermal masses with conduction between connected components
(`Q̇ = kA·ΔT/L`, using the thermal conductivity already in the database), specific heat
capacity added to the material model, and convective and radiative boundaries. Components
exceeding `maxOperatingTemperatureK` fail with the temperature chain that got them there.
Temperature-dependent yield strength turns this into the first real coupling: hot
structure is weak structure.

_Why here:_ every subsequent phase produces waste heat, and heat is the constraint that
makes fusion engineering hard.

---

## Phase 3 — Fluid systems ✅ V0.1

**In V0.1:** Closed single-phase loops (pressurised water, helium), Darcy–Weisbach with Swamee–Jain friction, parabolic pump curves, ε-NTU heat exchangers, loss-of-flow failures.
**Pressure boundary and cavitation:** a loop is held at its system pressure (15.5 MPa water, 8 MPa helium); an overheated water loop boils and its pressure follows the IAPWS-IF97 saturation curve, a helium loop pressurises as an ideal gas. Each pipe's peak hoop stress (Lamé, at loop pressure plus pump head) is checked against its yield at temperature: past it the pipe ruptures, the loop opens and circulation stops. Pumps lose head when the available NPSH, (p − p_sat)/ρg, falls below their rated NPSH (linear head loss — an approximation), so a boiling loop cavitates its pumps and the flow collapses. Pipe, pump and exchanger bodies ride at their loop temperature.
**Still missing:** Two-phase flow, flow transients, a pressuriser and relief valves (an overheating loop's pressure is only followed along saturation), blowdown dynamics after a break, cavitation erosion.

Incompressible flow in pipe networks. Pressure drop from Darcy–Weisbach with explicit
friction-factor correlations, pumps with real head/flow curves, and heat exchangers tying
back into Phase 2. Coolant loops become buildable and can be starved, cavitated or burst.

---

## Phase 4 — Magnetic fields ✅ V0.1

**In V0.1:** Ideal toroidal winding and on-axis finite solenoid fields, Princeton-D TF tension and solenoid hoop stress, quench. A coil's conductor is either _Rated_ (a fixed critical temperature) or _NbTi_, whose quench temperature is its critical surface Tc(B) at the coil's live peak field (Bottura 2000: Tc0 = 9.2 K, Bc20 = 14.5 T); above Bc20 an NbTi coil cannot superconduct and quenches as soon as it is energised.
**Quench protection:** each coil's self-inductance (ideal toroid μ₀N²(R − √(R² − a²)); Wheeler's formula for solenoids) and stored energy ½LI² are published. A quenched coil holds its current for the protection system's detection time, then discharges through the dump resistor with its time constant (dump power I²L/τ). Heat reaching a cold mass beyond its refrigeration boils helium at ṁ = Q/h_fg (20.7 kJ/kg).
**Geometry-derived field:** coils the analytic models do not cover — a player-built ring of _Circular Coils_, a tilted solenoid, a mirror pair — get their field from their geometry: Biot–Savart over the coil's current path in straight segments (exact finite-segment formula, Jackson §5.3; one filament per winding, softened inside the winding radius), projected onto each vessel's magnetic axis and averaged (`plant/biotSavart.ts`, `plant/fieldCoupling.ts`). Coefficients are linear in current, cached per layout, so a run stays fast and deterministic. Validated against the closed forms: a loop's centre and on-axis field (< 0.2 %), a finite solenoid (< 1 %), and 18 discrete toroidal coils against the ideal toroid (< 1 %, ripple < 1 %). Coil-by-coil ripple along the axis is reported; above 5 % the plasma result is labelled experimental (ripple losses are not modelled). A loop-wound torus coil has its own inductance (Grover), surface peak field and hoop tension (μ₀(NI)²/4π·(ln 8R/a − ¾)). The Magnetic view traces field lines from the same Biot–Savart field.
**Still missing:** inter-coil forces, field topology analysis (closed flux surfaces, rotational transform) for arbitrary geometries, D-shaped and racetrack coil paths; the current-sharing temperature (needs Jc(B,T) and the winding current density — Tc(B) is an upper bound on the margin); a REBCO critical surface; normal-zone propagation and hot-spot temperature inside the winding; charging.

Coil geometry to field: Biot–Savart for simple configurations, with documented
approximations for solenoids and toroids. Magnetic forces on conductors and the resulting
structural loads feed back into Phase 0 — the first time an electromagnetic result appears
as a mechanical one. Superconductor critical surfaces and quench as a failure mode.

---

## Phase 5 — Vacuum systems ✅ V0.1

**In V0.1:** Vessel pressure balance with pump speed and gas loads; breakdown needs vacuum; loss of vacuum disrupts.
**Assembled chambers:** hollow vessel segments joined flange to flange share one vacuum (`plant/chamber.ts`): volume, outgassing and leaks summed over segments; pumps, fuel and heating on any segment serve the whole chamber; wall and neutron heat split by wall area. What the chamber is follows from its joints — a closed ring is a toroidal plasma volume (major radius = centreline length / 2π, minor radius = narrowest bore × fill), a capped column a linear one, anything branched has no plasma estimate (UNSUPPORTED). Coils reach an assembled chamber through Biot–Savart along its centreline. An unjoined end flange is an opening to the hall with molecular-flow orifice conductance v̄/4 per unit area (air at 293 K: ≈ 116 m/s, the textbook 11.6 L/(s·cm²)) — a lower bound on the real viscous leak, so an open chamber can never be pumped down.
**Still missing:** conductance of ducts between chambers, non-circular (D-shaped) bores, pressure-dependent flow regimes.
**Still missing:** Conductance of ducts, outgassing curves.

Pumping speed, conductance, outgassing and leak rates; equilibrium pressure in a chamber.
Vacuum quality becomes a precondition for anything plasma-related, and vessel wall
material and temperature start to matter for reasons beyond strength.

---

## Phase 6 — Reduced plasma model ✅ V0.1 (0D)

**In V0.1:** Breakdown, current ramp, IPB98(y,2) or Bohm confinement, ohmic/auxiliary/alpha heating, bremsstrahlung, density feedback, Greenwald/Troyon/q95/β disruptions, controlled shutdown.
**Still missing:** Profiles (1D transport), MHD stability beyond limits, divertor physics — MHD and particle simulation are explicitly out of scope for V0.1.

A deliberately reduced zero- or one-dimensional plasma: density, temperature, confinement
time, and an energy balance with documented scaling laws rather than a transport code.
The approximations here will be the largest in ForgeLab and must be the most carefully
written down.

---

## Phase 7 — Fusion reaction model ✅ V0.1

**In V0.1:** Bosch–Hale D-T reactivity, alpha/neutron split, plasma gain Q.
**Still missing:** D-D and D-³He, fuel isotope accounting and tritium inventory.

D–T reactivity from published cross-section fits, fusion power from density, temperature
and volume, and the Lawson criterion as an emergent result of the player's design rather
than a checkbox. Tritium breeding requirements appear as a constraint.

---

## Phase 8 — Neutron transport and blanket ◐ partial

**In V0.1:** Exponential attenuation of neutron power through wall, blanket and coils; blanket heat to the coolant loop.
**Still missing:** Transport (no Monte Carlo in scope), tritium breeding ratio, activation, damage.

Neutron production from Phase 7, simplified attenuation and heating through blanket and
shield layers, tritium breeding ratio, and activation as a function of material and
fluence. Neutron heating couples into Phase 2; damage couples into Phase 10.

---

## Phase 9 — Control systems ◐ partial

**In V0.1:** Sensors and threshold interlocks (e.g. wall temperature → plasma shutdown).
**Still missing:** PID loops, sequences, operator scripting (scripting is out of scope for V0.1).

Sensors, setpoints, actuators and control loops with real dynamics. Plasma position and
current control, cooling and power management. This is where a design stops being a static
structure and becomes a machine that can be operated — and mis-operated.

---

## Phase 10 — Degradation and lifetime ○ not started

**In V0.1:** —
**Still missing:** Fatigue, creep, radiation damage, component lifetime.

Material property change under neutron fluence, thermal cycling and creep. Component
lifetime, maintenance intervals and end-of-life failure. This is the phase that makes a
design's _long-term_ viability matter, not just whether it works on the first run.

---

## Out of scope for the foreseeable future

Not because they are uninteresting, but because they are not physics and would compete
with it for attention: campaigns, characters, story, tech trees, research grinds,
narrative progression, and any stat that exists to be balanced rather than measured.
