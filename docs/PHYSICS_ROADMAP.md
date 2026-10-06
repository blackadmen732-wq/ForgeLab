# ForgeLab physics roadmap

The order physics arrives in, and why that order.

Each phase is built on the one before it. Nothing beyond Phase 0 is implemented, and
nothing beyond Phase 0 should be started until it is explicitly approved. What follows is
a statement of intent, not a promise about dates.

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

**Known gaps, in the order they hurt most.** No buckling — the single largest error in the
model, and the reason a slender steel column reads far stronger than it is. No bending,
shear or torsion. No elastic compatibility for indeterminate frames. No overturning. See
§6 of `ARCHITECTURE.md` for the full list.

**Phase 0.1, before moving on.** Euler buckling (`P_cr = π²EI/(KL)²`) and simple beam
bending. Both need Young's modulus added to `MaterialDefinition`; both are well-documented
closed-form relationships; both would make the structural model honest about the failure
mode real structures actually experience.

---

## Cross-cutting — Cascade failure solver ✅ reduced models implemented

Failures propagate by physical coupling: hazard emissions, spatial exposure, network
effects and each component's own limits, recorded as a causal graph. See
[`CASCADE.md`](CASCADE.md).

To make cascades possible now, it carries **reduced** versions of pieces of Phases 1–6:
lumped heat transfer and phase change, a radial electrical network with I²R heating and
protection, coolant loops with pipe pressure, a helium-bath magnet quench, and a plasma
disruption heat load, plus battery runaway, combustion and gas accumulation. Each phase
below, when it lands, should replace the corresponding reduced model behind the same
hazard and exposure interfaces, without changing how cascades are recorded.

---

## Phase 1 — Electrical circuits and power

Conductors, sources, loads and switches as a graph; nodal analysis for DC steady state.
Resistance from geometry and the resistivity already in the material database
(`R = ρL/A`). Resistive heating computed as a power figure, handed to Phase 2 when it
exists. Current and voltage limits produce explained electrical failure events.

_Why here:_ it is the simplest subsystem with real physics, it reuses material properties
already sourced, and nearly everything later needs power.

---

## Phase 2 — Heat and cooling

Lumped thermal masses with conduction between connected components
(`Q̇ = kA·ΔT/L`, using the thermal conductivity already in the database), specific heat
capacity added to the material model, and convective and radiative boundaries. Components
exceeding `maxOperatingTemperatureK` fail with the temperature chain that got them there.
Temperature-dependent yield strength turns this into the first real coupling: hot
structure is weak structure.

_Why here:_ every subsequent phase produces waste heat, and heat is the constraint that
makes fusion engineering hard.

---

## Phase 3 — Fluid systems

Incompressible flow in pipe networks. Pressure drop from Darcy–Weisbach with explicit
friction-factor correlations, pumps with real head/flow curves, and heat exchangers tying
back into Phase 2. Coolant loops become buildable and can be starved, cavitated or burst.

---

## Phase 4 — Magnetic fields

Coil geometry to field: Biot–Savart for simple configurations, with documented
approximations for solenoids and toroids. Magnetic forces on conductors and the resulting
structural loads feed back into Phase 0 — the first time an electromagnetic result appears
as a mechanical one. Superconductor critical surfaces and quench as a failure mode.

---

## Phase 5 — Vacuum systems

Pumping speed, conductance, outgassing and leak rates; equilibrium pressure in a chamber.
Vacuum quality becomes a precondition for anything plasma-related, and vessel wall
material and temperature start to matter for reasons beyond strength.

---

## Phase 6 — Reduced plasma model

A deliberately reduced zero- or one-dimensional plasma: density, temperature, confinement
time, and an energy balance with documented scaling laws rather than a transport code.
The approximations here will be the largest in ForgeLab and must be the most carefully
written down.

---

## Phase 7 — Fusion reaction model

D–T reactivity from published cross-section fits, fusion power from density, temperature
and volume, and the Lawson criterion as an emergent result of the player's design rather
than a checkbox. Tritium breeding requirements appear as a constraint.

---

## Phase 8 — Neutron transport and blanket

Neutron production from Phase 7, simplified attenuation and heating through blanket and
shield layers, tritium breeding ratio, and activation as a function of material and
fluence. Neutron heating couples into Phase 2; damage couples into Phase 10.

---

## Phase 9 — Control systems

Sensors, setpoints, actuators and control loops with real dynamics. Plasma position and
current control, cooling and power management. This is where a design stops being a static
structure and becomes a machine that can be operated — and mis-operated.

---

## Phase 10 — Degradation and lifetime

Material property change under neutron fluence, thermal cycling and creep. Component
lifetime, maintenance intervals and end-of-life failure. This is the phase that makes a
design's _long-term_ viability matter, not just whether it works on the first run.

---

## Out of scope for the foreseeable future

Not because they are uninteresting, but because they are not physics and would compete
with it for attention: campaigns, characters, story, tech trees, research grinds,
narrative progression, and any stat that exists to be balanced rather than measured.
