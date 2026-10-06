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

**Shadowing.** A part that crosses the line between two others blocks part of what they
exchange — both surface radiation and flame radiation (`occlusionTransmission`).
Box-shaped parts — the Concrete Wall and Floor Slab, decks, cabinets, battery modules —
block with their true oriented box: five parallel sight lines (the centre line and four
at half the smaller radius) are tested and the open fraction is the share no box crosses
with both ends outside it. Lines running below the ground plane are left out, so nothing
slips under a wall standing on the floor. Other shapes block with their equivalent
sphere: the beam between two spheres is never wider than the smaller one, so a part of
radius r_c blocks min(1, (r_c / r_small)²) of it. Shadows combine multiplicatively. A
wall between a burning bus and a battery module keeps the fire's heat off the module
(`reactor-components/src/rooms.test.ts`); a slab between two storeys separates them; parts
inside a box (a room, an enclosure) are not shadowed by it. Shadowing is computed lazily — only for pairs
that are actually exchanging heat — and cached per design (`ShadowIndex`), so cold designs
pay nothing for it.

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

**Battery cells.** A part runs away only if one of its regions is a cell material with
sourced runaway data (today: `li-ion-nmc-cell`, `li-ion-lfp-cell`, from Feng et al. 2018,
Golubkov et al. 2014 and Baird et al. 2020; confidence approximate). The catalogue has
_Battery Module (NMC)_ and _(LFP)_: about half of each module's envelope is cells.

- **Self-heating** is Arrhenius, `dT/dt = A·exp(−B/T)`, with A and B fixed by the two
  calorimetry definitions alone: 0.02 K/min at T1 and 1 K/s at T2. The cells' heat
  capacity times that rate is heat added to the part. Past T1 → `battery_self_heating`.
- **Runaway** at T2 → `thermal_runaway`: the cells release the adiabatic rise to T3
  (`m·cp·(T3 − T2)`, which already contains the electrical energy, because T3 is measured
  on charged cells) over the reaction time, and vent their gas mass fraction. Cooling
  cannot stop it once it has started.
- **Vent gas** burns at the vent when it leaves hotter than its auto-ignition temperature
  or meets a fire already burning on the part → `vent_fire`. It then radiates like any
  other fire (and is shadowed like any other). Otherwise it escapes unburned and the part
  reports how much. NMC runs away past its gas's auto-ignition temperature; LFP does not,
  which is why the two chemistries fail differently.
- Causality: a runaway caused by heat through space names the sender and links to its
  `fire`, `over_temperature`, `thermal_runaway` or `vent_fire` events, so runaway can
  propagate module to module through the graph.

Tests: `packages/reactor-components/src/battery.test.ts` (oven tests in the spirit of
battery abuse standards: NMC at 180 °C runs away and vents a jet fire; LFP runs away
below its gas's auto-ignition; a module at its 60 °C service limit does not).

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
- **Spheres.** For exchange, shape and orientation are ignored: a long wall heated by a
  fire is an equivalent sphere at its centre. Box parts shadow with their true box, but
  only five sight lines are sampled (coarse penumbra); other shapes shadow with their
  sphere, so a part that grazes the beam without crossing its centre line casts no
  shadow. Nested parts (one equivalent sphere inside another) do not exchange. A room has
  no air volume of its own: walls stop radiation, not hot gas (there is no plume yet).
- **The burning part's own heating** by its flame is not added: the free-burning rate
  already contains that feedback.
- **A battery module is one lumped temperature,** so all its cells run away together and
  its peak heat release is that of every cell at once; real modules propagate cell to cell
  over minutes. Size a part like a real module and rack several. The module is not on the
  electrical network yet (no charge, discharge or internal short from current).
- **Fires only radiate.** There is no buoyant plume or flame contact, so a fire under a
  part heats it no more than one beside it. A cable fire directly beneath a battery module
  therefore cannot drive it into runaway in this model, though in reality it can.
- **No suppression, smoke transport, oxygen depletion, gas accumulation, molten-metal
  contact or hot debris yet.** Those are next in the cascade
  solver (`docs/PHYSICS_ROADMAP.md`).
- This is a reduced engineering model for a game. It is **not** a fire-safety assessment.
