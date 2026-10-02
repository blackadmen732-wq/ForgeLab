# Hazards: heat through space, fire and cascades

> A changes the world. B sees the changed world. B's own physics decides.

ForgeLab's plant solver already couples parts through their ports: current through cables,
coolant through pipes, heat through bolted joints. Some of the most important failure
paths in a real plant do not use a port at all — a burning cable tray radiating onto the
next one, a hot vessel cooking a cabinet beside it. Those are **spatial** interactions
(CLAUDE.md §5, §36), so they travel through geometry and are never modelled as network
edges.

This page documents the first piece of the cascading failure solver
(`packages/sim-core/src/plant/hazards.ts`, integrated into the thermal substep of
`solver.ts`). Its confidence is **approximate** wherever it acts, and the snapshot says so
(`plant.confidence`, subsystem `hazards`).

## What is modelled

**Radiant exchange between parts.** Every part is an equivalent sphere with its own outer
surface area (r = √(A/4π)) at its centre of mass. Two parts exchange
`ε² σ A₁F₁₂ (T₁⁴ − T₂⁴)` with the far-field exchange area `A₁F₁₂ = π r₁² r₂² / d²` (which
is reciprocal), ε = 0.3 as for the losses to ambient. Heat that reaches a pipe, pump or
heat exchanger body goes into its coolant loop, because those bodies ride at the loop
temperature. Superconducting coils are excluded: their radiative load is part of their
static heat leak behind the thermal shield.

**Fire.** A part burns only if one of its material regions has sourced fire data — an
ignition temperature, an effective heat of combustion and a free-burning rate — in the
material library (today: XLPE cable insulation). Its burnable inventory comes from the
region's volume fraction and density. When the part's temperature reaches the ignition
temperature (in hall air), it burns at `ṁ = burning rate × outer area`, releasing
`Q = ṁ ΔHc`, until its fuel is gone. A fraction χr = 0.35 of `Q` is radiated (the
NUREG-1805 point-source flame model); a neighbour absorbs `ε χr Q r² / 4d²`. The rest leaves
with the plume. Materials that ignite but have no sourced burning data (graphite, G-10)
are reported above their ignition temperature — "no fire is modelled" — rather than
burned with an invented number.

**Conductors fail in stages.** Copper's 200 °C service limit is an annealing and insulation
limit, not the end of the conductor. Past it a bus raises `over_temperature` and keeps
carrying current (its resistance rising with ρ(T)); it opens the circuit only at its
sourced melting point, raising `melted`.

**Causality.** Each part publishes `thermal.spatialHeatInW` and
`thermal.spatialHeatSourceId` (who sent it the most heat through space), and a
`combustion` state (fuel, remaining fuel, ignition temperature, burning, heat release,
burning rate, which substances burn). A failure caused by heat through space names the
part that sent it and links to that part's own `fire`, `over_temperature` or `melted`
event in `causeKeys`, so the causal graph branches through space as well as along
networks.

**Determinism and performance.** Pairs come from a uniform-grid broad phase (bodies whose
reach spans more cells than there are bodies are tested against all), sorted by id.
Pairs are evaluated only when either surface is above 400 K or a fire is burning, and
pairs whose larger view factor is under 1e-4 are never coupled. These are culling
choices, not physics; they change the result by watts.

## The reference cascade

`packages/reactor-components/src/cascade.test.ts` runs the showroom's
_electrical-bus-fault_ design — the reference plant with its main bus sized at 1 mm² —
and nothing is scripted:

1. The bus heats by I²R past copper's 200 °C limit → `over_temperature` (≈ 17 s).
2. It keeps conducting; its XLPE sleeve reaches 350 °C → `fire` (≈ 27 s), about 3.7 MW
   from 14 kg of fuel (0.026 kg/(m²·s) × 3.26 m² × 43.3 MJ/kg). Its neighbours, which share
   no port with it, receive kilowatts through space.
3. Copper melts → `melted` (≈ 56 s): the circuit opens.
4. Every load loses power → `supply_shortfall`, the pump → `loss_of_flow`, and the plasma
   → `disruption`. The fire keeps burning until its fuel is gone.

**The protected variant stops it.** The same design with a thermocouple on the bus and an
interlock that opens a breaker on the grid feed at 420 K trips before the copper limit:
no over-temperature, no fire, no melt. The plant loses power — protection costs the shot
and saves the hall. Cascades stop through protection, distance (1/d²), fuel exhaustion and
cooling, because those are what the physics contains.

## Known limits (honest)

- **Lumped temperature.** A part has one temperature. A thin combustible skin on a massive
  part (the sleeve on a 0.9 t copper bar) ignites only when the whole part does, so fire
  does not spread from bar to bar the way it would along real cable trays. Surface
  ignition needs XLPE's thermal inertia or critical heat flux, which are not yet sourced.
- **Spheres and no shadowing.** Shape, orientation and parts in between are ignored.
  Nested parts (one equivalent sphere inside another) do not exchange.
- **The burning part's own heating** by its flame is not added: the free-burning rate
  already contains that feedback.
- **No suppression, smoke transport, oxygen depletion, gas accumulation, battery
  chemistry, molten-metal contact or hot debris yet.** Those are next in the cascade
  solver (`docs/PHYSICS_ROADMAP.md`).
- This is a reduced engineering model for a game. It is **not** a fire-safety assessment.
