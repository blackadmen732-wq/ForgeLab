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

**In V0.1:** DC nodal analysis per island, sources, loads, conductors with R = ρL/A, breakers, proportional curtailment, supply-shortfall and burn-out failures.
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
**Still missing:** Spatial temperature gradients, temperature-dependent material properties (hot structure is not yet weaker).

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
**Still missing:** Two-phase flow, flow transients, pressure-boundary failures.

Incompressible flow in pipe networks. Pressure drop from Darcy–Weisbach with explicit
friction-factor correlations, pumps with real head/flow curves, and heat exchangers tying
back into Phase 2. Coolant loops become buildable and can be starved, cavitated or burst.

---

## Phase 4 — Magnetic fields ✅ V0.1

**In V0.1:** Ideal toroidal winding and on-axis finite solenoid fields, Princeton-D TF tension and solenoid hoop stress, quench.
**Still missing:** Biot–Savart fields from real coil shapes, inter-coil forces, field ripple.

Coil geometry to field: Biot–Savart for simple configurations, with documented
approximations for solenoids and toroids. Magnetic forces on conductors and the resulting
structural loads feed back into Phase 0 — the first time an electromagnetic result appears
as a mechanical one. Superconductor critical surfaces and quench as a failure mode.

---

## Phase 5 — Vacuum systems ✅ V0.1

**In V0.1:** Vessel pressure balance with pump speed and gas loads; breakdown needs vacuum; loss of vacuum disrupts.
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
