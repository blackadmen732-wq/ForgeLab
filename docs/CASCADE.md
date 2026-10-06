# The cascading multi-physics failure solver

> A changes the world. B sees the changed world. B's own physics decides what happens.
> If B fails, B changes the world again. Repeat.

This document describes `packages/sim-core/src/cascade/`: how ForgeLab decides what a
failure does to everything around it. It is the authority on what the cascade models, what
they leave out, and where every number came from.

**ForgeLab is not fire-safety, arc-flash, battery-abuse or pressure-equipment certification
software.** Every model here is reduced, and is labelled with how much to trust it.

---

## 1. The master rule

ForgeLab never writes "A failed, so explode B because it is nearby". Instead:

```
A fails
 → work out exactly what physical outputs A releases     (hazard emissions)
 → propagate those outputs through space and networks    (spatial query + exposure)
 → work out what B actually receives                     (component exposure)
 → update B's physical state                             (thermal, chemical, fluid, ...)
 → B fails only if B's own limit is crossed              (B's thresholds)
```

Distance alone never causes failure. Physical coupling does. Two tests enforce this:

- `cascade-models.test.ts` → "distance alone never causes failure": a battery beside a part
  that has structurally failed — but emits nothing — stays at ambient with no events.
- `cascade-reference.test.ts` → "causally closed": in the full reference cascade, **every
  event except the single induced fault has at least one physical parent**, and every
  parent happened no later than its child.

---

## 2. Scheduler

The cascade runs inside `SimulationWorld.step()`, once per fixed 1/60 s step, after the
structural solve and the rigid-body step. **A cascade is never executed recursively in one
call.** Each step:

| Stage | What happens                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Apply induced faults that are due. Hand over structural failures. Check flanges. Solve networks: electrical, coolant, cryogenic, plasma. |
| B     | Derive hazard emissions from every component's current state.                                                                            |
| C     | Propagate each hazard through the spatial broad phase and compute what each target receives.                                             |
| D     | Move hot debris and molten parcels; resolve their impacts.                                                                               |
| E     | Solve thermal response (conduction, radiation, convection, coolant, phase change) and gas accumulation.                                  |
| F/G   | Evaluate every model's own thresholds; record new events and their physical causes in the catastrophe graph.                             |

Time advances physically, so chain effects evolve over time. In the unprotected reference
plant the joint overheats at 92 s, arcs at 258 s, the fire spreads along the cable tray at
~580 s, and the first battery cell runs away at ~1110 s. Those times come from the
simulation, not from a script.

The cascade feeds back into structure: each step it hands the structural solver a
**hot-strength factor** for every heated component, so a hot steel member is checked
against its reduced yield. If it fails (and `failurePropagation` is `detach`), what it
carried falls, and the cascade sees the displacement on the next step.

---

## 3. Hazard emissions

A `HazardEmission` is one physical output of a component's current state: `kind`, family,
origin, direction, start time, duration, source size, reach, radiant and convective power,
gas temperature, mass flow, jet force, overpressure, substance, whether it can ignite
things, and **the causal event that started it**.

| Kind                | Comes from                                                     | Physics                                                                       |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `radiant-surface`   | Any surface > ambient + 150 K                                  | `P = ε σ A (T⁴ − T∞⁴)`                                                        |
| `flame`             | Burning combustibles, battery jet fires, deflagration fireball | Radiative fraction χ_r · HRR as radiation; the rest as a buoyant plume        |
| `hot-gas`           | Unignited battery vent gas                                     | Sensible enthalpy of the gas as a plume                                       |
| `electric-arc`      | Arcing faults                                                  | `P = V_arc · I_arc`, split 40 % radiant / 40 % electrode / 20 % gas (reduced) |
| `fluid-jet`         | Pipe rupture or flange separation                              | Orifice flow `ṁ = C_d A √(2ρΔP)`, jet force `ṁ·v`, flashing steam             |
| `pressure-wave`     | Confined deflagration                                          | `ΔP = (γ − 1) E / V`, capped by vent panels                                   |
| `smoke`             | Burning combustibles                                           | Smoke yield × burning rate (tracked for the enclosure)                        |
| `cryogenic-gas`     | Helium boil-off                                                | Cooling capacity of the boil-off gas                                          |
| `plasma-wall-heat`  | Plasma disruption                                              | Thermal quench energy on a wetted wall fraction                               |
| `radiation-heating` | Burning plasma                                                 | Isotropic neutron/gamma power, fully absorbed where intercepted               |

Hazards are re-derived every step from state. A fire emits a `flame` every step it burns,
at whatever power its remaining fuel supports.

---

## 4. Spatial query and exposure

`SpatialHash` is a uniform-grid broad phase (4 m cells). Each hazard queries only the
components within its reach. Queries are clipped to the occupied extent, so a 60 m plume
reach costs no more than a 6 m one. Results are always sorted by id. A test checks the hash
against brute force on 300 boxes and 50 queries.

Reach is a **performance cutoff, not physics**: radiation is skipped below 100 W/m² (at
which a steel member warms by well under 0.01 K/s), and plumes below 2 K excess.

What a target receives:

- **Radiation.** Point source, flux `P / (4π d²)` at the nearest point of the target box
  (never closer than the source radius). Intercepted power uses Cauchy's theorem: a convex
  body's mean projected area is a quarter of its surface. Absorbed = emissivity ×
  intercepted. **Shielding:** if the line from source to target crosses an intact barrier,
  the target receives nothing and the barrier takes it.
- **Plumes.** Heskestad centreline excess temperature `ΔT = 25 Q_c^(2/3) z^(-5/3)` (kW, m),
  capped at the McCaffrey continuous-flame value of 800 K. Only targets above the source and
  inside the plume radius are immersed, and only the fraction of their footprint the plume
  covers. Net heat flux follows **EN 1991-1-2 §3.1**: `α_c (T_g − T_m) + ε_m σ (T_g⁴ − T_m⁴)`
  with `α_c = 25 W/(m²·K)`.
- **Jets.** 15° cone; momentum load shared by projected area; steam heating.
- **Conduction.** Along every connection whose sockets are still together:
  `G = k A / L`, harmonic-mean conductivity, smaller section, centre distance.
- **Pilots.** A flame, arc or spark ignites only what it touches: within 1 m of its source.
  Hot surfaces ignite gas only by contact, through the enclosure check (§10).

`ComponentExposure` records it all per step: heat flux, radiant flux, conducted and
convected heat, hot-gas temperature, flame contact, jet load, pressure impulse, peak
overpressure, debris energy, arc exposure, flammable gas fraction, cryogenic cooling, plasma
heat flux and absorbed radiation. These are simulation inputs. The renderer only reads them
for the hazard view.

---

## 5. Thermal bodies and phase change

Every component is a lumped thermal body: structural mass × material specific heat, plus
any declared inventories (pipe water, combustible fuel). `additionalMassKg` is excluded,
because its substance is unknown. Some components contain **internal bodies** coupled by
conductance: battery cells, a bus conductor, a barrier's unexposed face.

Ambient losses: EN 1991-1-2 `α_c = 4 W/(m²·K)` plus explicit radiation. The update is
implicit in each body's own temperature and explicit in its neighbours'. Every row is
diagonally dominant, so it is stable at the fixed step for any conductance.

**Melting is not gas generation.** Phase change uses the enthalpy method. A body reaching
its melting point holds there while latent heat is absorbed, and continues heating only
once fully liquid. Melting is solid → liquid only. Gas comes from exactly four separate
processes: boiling (water, helium), decomposition/evaporation (insulation, oil), battery
venting, and combustion products. A test melts a copper bar inside a sealed room and checks
that the plateau sits exactly at 1357.77 K and that the room gains no gas.

**Hot strength.** Carbon steel follows EN 1993-1-2 Table 3.1 (`k_y,θ` = 1.00 to 400 °C,
0.78 at 500 °C, 0.47 at 600 °C, 0.23 at 700 °C, ...). Other metals use a labelled
approximation: full strength to their service limit, falling linearly to zero at melting.

---

## 6. Batteries

There is no universal "battery explodes" rule. A module is a row of cells with a chemistry
(`nmc` or `lfp`), state of charge, cell mass and energy, inter-cell conductance, and
cabinet-to-cell conductance (end cells, which touch the side walls, can differ from inner
cells).

Each cell moves through `normal → heated → venting → self-heating → runaway → burned-out`
on its own temperature:

- **Self-heating** is `dT/dt = A·exp(−B/T)`, calibrated through the two accelerating-rate
  calorimetry (ARC) definitions in Feng et al. (2018): 0.02 K/min at T1 and 1 K/s at T2.
  Nothing else sets the rate.
- **Runaway** releases `m·cp·(T3 − T2)`, the adiabatic rise to the chemistry's maximum
  temperature, over the reaction time. It vents a gas mass fraction and ejects hot
  particles. Stored electrical energy is part of T3 (ARC tests use charged cells), so an
  internal short stops contributing once runaway starts.
- **Vent gas** ignites at the vent if it leaves hotter than its auto-ignition temperature,
  or if a pilot is in contact. Otherwise it goes into the enclosure. That is why NMC
  (T3 ≈ 780 °C) burns as a jet fire, while LFP (T3 ≈ 420 °C) releases unburned gas that can
  accumulate.
- **Propagation** is never scripted. Runaway heat reaches neighbouring cells by conduction
  and adjacent modules by radiation, plumes and jet fires. In the reference plant the end
  cells run away first, and their neighbours follow about 250 s later.

---

## 7. Fire

A combustible has a kind (transformer oil, PVC or XLPE insulation), a mass and a burning
area. Above **decomposition** it releases vapour. A rising share of absorbed heat goes into
gasification (heat of gasification) rather than temperature, reaching all of it at the
auto-ignition temperature. Like boiling, this caps unpiloted fuel below auto-ignition.
**Ignition** needs piloted-ignition temperature plus a pilot in contact, or auto-ignition
temperature. Burning uses a steady mass burning rate per area, heat of combustion,
radiative fraction and smoke yield. The flame also engulfs the burning item itself
(EN 1991-1-2 flame exposure on the wetted area).

Fire spreads only when heat reaches more combustible material. Steel next to a fire heats
and weakens but never burns: a test checks this, together with a PVC cable above the same
fire igniting with the oil fire as its ancestor. Long combustibles should be modelled in
sections (the reference cable tray is three 1.5 m sections), because a lumped body cannot
ignite locally.

---

## 8. Electrical network

Elements are declared `source`, `conductor`, `breaker` or `load`, and joined by the
world's `electrical` connections. The network is solved as a radial tree from each source.
Loads are constant power at nominal voltage, and a load with two feeds draws from the first
energized one (an automatic transfer).

- Conductors heat by `I²R`, with resistance from geometry and resistivity
  (`R = ρL/A`, IEC 60028 temperature coefficient for copper), plus any degraded-joint
  resistance.
- Insulation crossing its continuous rating raises `conductor-overheated`. Crossing its
  short-circuit limit (IEC 60364-5-52 / IEC 60949: PVC 70/160 °C, XLPE 90/250 °C) raises
  `insulation-breakdown` and strikes an **arc**.
- The arcing fault current flows through every element between the source and the arc.
  A breaker opens when the current stays above its pickup for its delay. If the pickup is
  above the arcing current, the breaker never sees the fault.
- An uncleared arc erodes conductor metal (heat to melting plus latent heat) and ejects it
  as molten parcels, until it **burns the circuit open**.
- Loss of energization raises `power-lost` on loads, with the opening event as its parent.
  Pumps then coast down; cryoplants stop refrigerating.

---

## 9. Coolant, pipes and pressure

Coolant loops have an inventory, supply temperature, operating pressure and minimum
inventory for pump suction. Flow cools pipes and cooled loads (UA × flow fraction). Lost
flow is attributed to whatever stopped it, but only for heat that actually arrived, because
flow cannot remove more than comes in.

Pipe pressure: an **open line** sits at loop pressure, and heated water boils off into the
loop. A **blocked-in** section follows the IAPWS-IF97 saturation curve (region 4, eq. 30;
checked against the standard's verification table). A relief valve caps it at its set point
by venting steam. Rupture happens when thin-wall hoop stress `P·r/t` exceeds hot yield.
Flanges open when the parts they join are pulled further apart than as-built by more than
their limit. Blowdown is orifice flow, and the escaping coolant flashes to steam:
`x = cp (T − T_sat,atm) / h_fg`.

---

## 10. Gas accumulation

Enclosures are well-mixed volumes with mechanical ventilation (air changes per hour). Each
gas family is tracked by mass. The flammable volume fraction is compared against the
mixture's lower flammability limit (Le Chatelier). Gas is never ignited merely because it
exists:

```
RELEASED → DISPERSED                                  (open air, or ventilated away)
RELEASED → ACCUMULATED → above LFL → ignition source → DEFLAGRATION
```

An ignition source is an ignition-capable hazard inside the enclosure, or a surface hotter
than the gas's auto-ignition temperature. A deflagration burns the flammable mass and
raises `ΔP = (γ − 1) E / V` (constant-volume, ideal gas), capped by deflagration vent
panels. It emits a pressure wave (which can fail barriers rated below it) and a fireball.
Both tests — accumulation without ignition, and ΔP equal to the formula — run on LFP vent
gas.

---

## 11. Magnets and plasma

A cryostat holds liquid helium. Heat leaks in through `G (T_outer − T_cold)` and is removed
by a powered cryoplant. Net heat boils helium (latent heat 20.7 kJ/kg) and releases cold
gas. After dry-out the cold mass warms. Its temperature comes from integrating the
**Sommerfeld + Debye** low-temperature heat capacity of copper (`γT + βT³`, matching NIST at
10 K) and inverting the enthalpy. Multiplying by cp at the current temperature would
overshoot by hundreds of kelvin at 4 K.

Crossing the current-sharing temperature **quenches** the magnet. Current decays with the
unprotected time constant (energy into the coil) until quench detection opens a dump
switch, after which `τ = L/R_dump` and the energy goes to the external resistor. When the
field falls below the plasma's minimum, the plasma **disrupts**. Its thermal energy lands on
a wetted wall fraction within the thermal-quench time, and the surface rise uses the
semi-infinite-solid closed form `ΔT = 2q√(t/(πkρc))`. A controlled shutdown (on low coolant
flow, low field or high wall temperature) ramps the plasma down instead. A quench is faster
than any ramp-down, however, so control cannot save a plasma whose magnet quenches, and a
test shows that.

---

## 12. Structure reacting to heat, and hot debris

Hot members are checked against hot yield (§2). A heated member whose structural check
fails raises `support-yielded`, and everything it was carrying is marked as displaced by
that event. A test heats a slender steel support under a 14 t vessel until EN 1993-1-2
strength loss makes it yield. The vessel drops, the flange to its pipe opens with
`support-yielded` as its parent, and coolant blows down as steam.

Hot debris is aggregated into parcels of mass, temperature, velocity and material, launched
on deterministic directions (a golden-angle spiral, not randomness). On impact a parcel
delivers ½mv² and, as an upper bound, all its heat above the target's temperature,
including latent heat if molten. A battery struck harder than its crush tolerance develops
an internal short.

---

## 13. The catastrophe graph

Every event records the events that physically caused it. Parents come from an
**attribution ledger** per body, which records energy received by causal event: radiation
and plume heat from a hazard is credited to the event that started that hazard, conducted
heat to the neighbour's current cause, and lost cooling to whatever stopped the flow. A
threshold crossing lists the events that delivered at least 20 % of the attributed energy
(up to three). Network events are attributed directly: a power loss to the breaker or
burn-through that opened the path, a pump stop to its power loss, and so on.

The 20 % share is bookkeeping, not physics. It decides which arrows the graph draws, never
whether anything fails.

**Root cause versus most dramatic event.** The diagnosis finds the event that released the
most energy, then walks parents back to a root. In the unprotected reference plant the
largest event is the switchgear cable fire (~650 MJ). The root cause is a bolted joint with
20 mΩ of extra resistance. The diagnosis says exactly that, with the chain between them.

Cascade events that are failures also appear in the world's failure log, with their system
(`electrical`, `thermal`, `fluid`, `magnetic`, `plasma`) and cause sentence.

---

## 14. Chains must be able to stop

A cascade stops when physics stops it: a breaker isolates the fault, a barrier holds,
distance reduces exposure below what can heat anything, cooling removes heat, a relief
valve opens, a battery module is isolated by inter-cell barriers, a support survives, or
control shuts equipment down. None of this is a special case in the code. They are all
ordinary physical consequences of the design.

## 15. Reference cascade

`buildReferenceCascade(world, design)` in `packages/reactor-components` builds switchgear
with a PVC-insulated bus, a transformer, a cable tray over two NMC battery modules, a coolant
line over the batteries, a slender steel support carrying a pressurizer, a pump, a cryoplant,
a superconducting magnet and a reactor chamber, all in one hall. **Exactly one fault** is
induced: a bolted joint on the bus degrades and adds 20 mΩ.

| Design                                                                                                                 | What the physics does                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unprotected                                                                                                            | Joint overheats → insulation breaks down → arc the breaker cannot see → cabinet cable fire → bus burns open (pump, cryoplant lose power) → fire spreads along the tray → helium boils off → quench → plasma disruption → first wall melts locally → battery cabinet heats → cell runaway propagates cell to cell |
| Fast breaker only                                                                                                      | The arc is cleared in 0.1 s and there is no fire. But isolating the only feeder also stops the cryoplant, so the cascade still reaches the magnet and the plasma: protection without redundancy                                                                                                                  |
| Protected (fast breaker, redundant feeder, barrier and separation, cell barriers, relief, quench dump, plasma control) | The same arc is cleared in 0.1 s (22.5 kJ). Pump and cryoplant transfer to feeder B. Only the auxiliary load goes dark. **The cascade stops at the seventh event.**                                                                                                                                              |

All three are tested. The scenes are in the workspace's Scenes list.

## 16. Presentation

The renderer draws what the solver says and nothing else. Each phenomenon keeps its own
appearance (`apps/web/src/scene/theme.ts`): orange flame with a pale core, dark smoke,
blue-white arcs, white steam jets, pale-blue cryogenic fog, violet plasma, molten parcels,
and incandescent steel whose glow follows the solver's temperature. They are never merged
into one explosion sprite.

- **Hazard view** (toolbar) recolours components by what they are receiving: radiant heat
  (with 12.5 and 4 kW/m² contours computed in sim-core), hot gas, fire area, gas cloud,
  pressure release, hot debris, electrical faults.
- **Cascade tab** shows the diagnosis, a timeline coloured by causal depth, and every event
  labelled ROOT / SECONDARY / TERTIARY with links to its causes. **Watch cascade** restarts
  the run. Clicking any event **replays** to it. Because the simulation is deterministic,
  replay means re-simulating from the start in short slices per frame, not playing back a
  recording.

## 17. Data and where it came from

| Value                                                               | Source                                                                      | Class          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------- |
| Stefan–Boltzmann constant, gas constant                             | CODATA 2018                                                                 | Sourced        |
| Convective coefficients 25 and 4 W/(m²·K); net heat flux to members | EN 1991-1-2 §3.1, §3.2.1                                                    | Sourced        |
| Hot carbon-steel yield factors                                      | EN 1993-1-2 Table 3.1                                                       | Sourced        |
| Metal cp, melting point, latent heat, emissivity                    | `docs/material-sources.md`                                                  | Sourced        |
| Water saturation pressure                                           | IAPWS-IF97 region 4                                                         | Sourced        |
| Water cp, latent heat; helium boiling point and latent heat         | Steam tables; NIST                                                          | Sourced        |
| Cryogenic copper heat capacity                                      | Sommerfeld γ = 0.695 mJ/(mol·K²), Debye θ = 343 K; agrees with NIST at 10 K | Sourced form   |
| Plume temperature; continuous-flame cap                             | Heskestad (SFPE Handbook); McCaffrey (1979)                                 | Sourced        |
| Insulation continuous and short-circuit limits                      | IEC 60364-5-52 / IEC 60949                                                  | Sourced        |
| Copper/aluminium resistance temperature coefficient                 | IEC 60028; handbook                                                         | Sourced        |
| Oil and polymer heat of combustion, gasification, burning rate      | SFPE Handbook (Babrauskas; Tewarson)                                        | Sourced        |
| Oil flash point                                                     | IEC 60296 minimum                                                           | Sourced        |
| Decomposition / ignition temperatures of oil and cable compounds    | Inside reported ranges                                                      | Representative |
| Li-ion T1, T2, T3, vent temperature, gas and ejecta fractions       | Feng et al. 2018; Golubkov et al. 2014                                      | Representative |
| Li-ion vent gas LFL, heat of combustion, auto-ignition              | Baird et al. 2020 and constituent gases                                     | Representative |
| Self-heating rate definitions (0.02 K/min, 1 K/s)                   | Feng et al. 2018                                                            | Sourced        |
| Arc energy partition 40/40/20                                       | Arc-flash literature, order of magnitude                                    | Representative |
| Barrier insulation criterion (140 K average rise)                   | EN 1363-1                                                                   | Sourced        |
| Reference flux levels 12.5 and 4 kW/m²                              | Common fire-engineering references                                          | Display only   |

Every scene parameter (dimensions, inventories, protection settings) is a design input,
chosen as a builder would choose it. None is a failure probability, and none was tuned to
make a particular part fail.

## 18. Documented approximations

- Lumped bodies: no temperature gradients inside a component, so a long or large object
  heats as a whole (model long combustibles in sections).
- Point-source radiation; no view factors between extended surfaces; no re-radiation from
  smoke layers. No two-zone hot-gas layer under a ceiling.
- Plumes are unconfined Heskestad plumes: no ceiling jets, no wind, no flame tilt.
- Well-mixed enclosures: no stratification or local gas pockets.
- Combustion: steady burning rates, no oxygen limitation, no flame spread inside a section.
- Electrical: radial, nominal voltage, constant-power loads, no transients, no voltage
  drop, definite-time protection only. Arc power uses a fixed arc voltage.
- Pipes: no two-phase choking, water hammer or pipe whip. Saturation pressure is capped at
  the critical point (conservative above it).
- Batteries: one lumped temperature per cell. Self-heating reactants are not depleted
  before runaway.
- Magnets: no normal-zone propagation, no electromagnetic forces from the quench.
- Plasma: thermal quench only; no current quench, halo currents or runaway electrons.
- Debris: no drag, no cooling in flight, no fragmentation model.
- Determinism holds within one JavaScript engine. Debris launch directions and Arrhenius
  rates use `Math.cos`, `Math.sin` and `Math.exp`, which are not specified to the last bit
  across engines.

## 19. Adding to it

A new hazard or response model should:

1. Put its numbers in `cascade/data.ts`, labelled SOURCED or REPRESENTATIVE, and record them
   in §17.
2. Emit hazards from state in `#deriveHazards`. Never reach into another component's state.
3. Respond only to exposures and its own state, and raise events only on its own limits.
4. Give every event its physical parents (ledger or network cause).
5. Add a focused test, and check that the reference cascade stays causally closed.
