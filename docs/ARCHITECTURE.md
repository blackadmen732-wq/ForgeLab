# ForgeLab architecture

> We provide the components and physics. The player decides what to build.
> Reality decides whether it works.

This document describes how ForgeLab is put together and, more importantly, which rules
are not negotiable. It covers Milestone 0 — gravity and structure — and the seams that
later physics phases plug into.

---

## 1. Simulation and rendering are separate, and the simulation wins

There is exactly one authority on what is physically true: `packages/sim-core`. Everything
else reads from it.

```
                    ┌──────────────────────────────┐
  commands ───────► │      @forgelab/sim-core      │
  (place, move,     │                              │
   set material,    │  SimulationWorld  ← the only │
   step, reset)     │    mutable state in ForgeLab │
                    └──────────────┬───────────────┘
                                   │  getSnapshot()  (immutable, frozen)
                                   ▼
                    ┌──────────────────────────────┐
                    │  apps/web  (React, R3F)      │
                    │  draws what it is given      │
                    └──────────────────────────────┘
```

**The rules.**

1. `sim-core` must not import React, Three.js, `@react-three/*`, or touch the DOM. It runs
   unchanged in Node, in a web worker, or on a server.
2. Rendering contains no reactor physics. If a number appears on screen, a solver in
   `sim-core` produced it. React never computes a physical quantity.
3. UI state never determines physical truth. Selection, camera, snapping, gizmo mode and
   panel layout live in the app and are invisible to the engine.
4. `sim-core` has no presentation concepts. It classifies utilization as `normal` /
   `stressed` / `failed`; what colour those are is decided in `apps/web/src/scene/theme.ts`
   and nowhere else.

**How the rules are enforced.** `packages/sim-core/src/architecture.test.ts` scans the
source of every simulation package and fails the build if any of them imports a renderer,
references a browser global, uses a non-deterministic source (`Math.random`, `Date.now`,
`performance.now`), or mentions colour. An ESLint rule blocks the same imports at author
time. A lint rule can be disabled inline; the test cannot.

### Data flow in one direction

The interface issues **commands** (`addComponent`, `setTransform`, `setMaterial`, `step`).
The world decides what those mean and publishes an immutable **snapshot**. Components,
their state, and every vector inside them are frozen objects, so a renderer that tries to
write back gets a `TypeError` rather than a silent divergence.

`apps/web/src/state/store.ts` is the only bridge. It holds the world, translates UI
intent into commands, and publishes snapshots to React through `useSyncExternalStore`.
It is plain TypeScript with no React in it.

---

## 2. Fixed timestep

The simulation advances in fixed steps of `1/60 s`. Nothing varies the step, ever.

```
SimulationLoop.advance(realDeltaSec)
    requestedSimTime += realDeltaSec × speed
    targetSteps       = floor(requestedSimTime / dt)
    run (targetSteps − stepsAlreadyRun) fixed steps
```

**The guarantee.** _The world's state after N steps is a function of N and the initial
conditions alone._ Frame rate, frame jitter and playback speed change only how quickly N
grows — never what the state at a given N is.

**Why the target is derived rather than accumulated.** The usual accumulator pattern
subtracts `dt` from a running float each step. Over a long session that accumulates
rounding error and will eventually drop or duplicate a step. Deriving the target step
count from a running total of requested time cannot drift. A test runs 6000 irregular
frames and asserts the step count is still exact.

**Playback speed** (`0`, `1×`, `2×`, `5×`, `10×`) multiplies how much simulated time a
frame requests. It never touches `dt`, so every speed walks the identical sequence of
states — there is no numerical tolerance to document, because there is no difference.

**Catch-up is bounded.** A frame will not run more than `maxStepsPerFrame` steps. If the
machine cannot keep up, simulated time falls behind real time and the shortfall is
reported as `droppedTimeSec`, rather than the tab freezing while it tries to catch up.

**Determinism.** No randomness, no wall clock, no hash-order iteration — every collection
is sorted by id before it is walked, and ids come from a per-world counter. Identical
inputs give identical outputs, bit for bit, within one JavaScript engine. Cross-engine
bit-identity is not claimed, because `Math.sin`/`Math.cos` are not specified to the last
bit; nothing in Phase 0 physics depends on them.

---

## 3. SI units

Every quantity stored, computed or serialized anywhere in ForgeLab is in base SI:
metres, kilograms, seconds, newtons, joules, watts, pascals, kelvin. There is no display
unit layer inside the simulation. Conversion happens at the very edge of the interface and
never flows back in.

Three things keep it that way:

1. **Naming.** Every field carrying a physical quantity ends in its unit suffix:
   `massKg`, `positionM`, `linearVelocityMps`, `appliedStressPa`, `timestampSec`,
   `gravityMps2`. A field with no unit suffix is not a physical quantity.
2. **Types.** `@forgelab/shared` exports `Meters`, `Kilograms`, `Newtons`, `Pascals`,
   `Kelvin` and friends. They are documented aliases rather than nominal brands so that
   ordinary physics reads like physics (`F = m * g` rather than a pile of casts). A
   `Branded<>` helper is exported for the day a specific quantity needs hard enforcement.
3. **Conversions.** The helpers in `units.ts` are the only sanctioned way to cross a unit
   boundary — `megapascalsToPascals`, `gramsPerCm3ToKgPerM3`, `celsiusToKelvin`,
   `microOhmCmToOhmMeters`. An inline factor such as `x * 1000` is a bug.

`STANDARD_GRAVITY_MPS2 = 9.80665` is the CGPM-defined exact value.

---

## 4. Components

```ts
interface SimulationComponent {
  id: ComponentId;
  type: string; // catalogue type, e.g. "reactor-chamber"
  transform: Transform; // where the builder put it
  geometry: ComponentGeometry; // box or cylinder, solid or shell, in metres
  materialId: MaterialId; // a reference, never a copy of the properties
  massKg: Kilograms; // derived: volume × density + contents
  connections: readonly Connection[]; // links this part is part of
  connectionPoints: readonly ConnectionPoint[];
  additionalMassKg: Kilograms;
  anchored: boolean;
  state: ComponentState; // what the solvers decided
}
```

**`transform` versus `state.physical`.** `transform` is the _design_: where the builder
placed the part. `state.physical` is the _run_: where it actually is right now, plus its
velocities. They start equal and diverge the moment something falls. Keeping them apart
makes `reset()` exact rather than approximate, and lets a save file record both.

**Mass is always derived.** `resolveMassKg(geometry, materialId, additionalMassKg)` is the
only place mass is produced. Because material is held as an id and density is looked up,
"swap the material and the mass changes" is true by construction rather than by
remembering to recompute. `additionalMassKg` carries mass the geometry does not describe —
vessel inventory, internals, ballast — and is stored separately so it cannot contaminate
the geometry-derived part.

**Geometry is real.** Sizes are metres, and a `wallThicknessM` makes a primitive a shell
instead of a solid. This matters: a solid steel reactor vessel would weigh an order of
magnitude more than a real one, and every structural result below it would be wrong to
match. Volume uses closed-form expressions, documented in `geometry.ts`.

**`ComponentState` is where subsystems land.** Today it holds `physical`, `support` and
`structural`. Each later phase adds a sibling field written by exactly one solver, which
is what keeps subsystems independently testable.

**Unknown material ids throw.** They are never silently replaced with a default, because
that would silently change every mass and stress downstream.

---

## 5. Connections

A `ConnectionPoint` is a socket on a component: a local position, an **outward normal**,
a connection type, and an optional load rating. A `Connection` is an established link
between two sockets on two components.

The normal is not decoration. The structural solver reads it to decide which way load
flows: a socket on the underside of a beam points −Y, so the beam is the thing being held.
When neither normal is clearly vertical, the solver falls back to which socket sits higher;
sockets at the same height with no vertical normal are a lateral tie and carry no vertical
load in Phase 0.

**Types.** Phase 0 implements `structural` and `mount`. The names `electrical`, `coolant`,
`vacuum`, `fuel`, `control` and `shaft` are reserved in `CONNECTION_TYPES` so that files
written today keep their meaning when those phases land. Nothing reads them yet.

**Ratings.** A structural socket in the built-in catalogue is rated at _the member's own
section area perpendicular to the socket normal, times the material's yield strength_ —
the documented assumption being that the joint is no stronger than the member it sits on.
That is a real relationship built from real material data, not an invented bolt pattern.
Mount sockets carry no default rating, because ForgeLab has no basis for a flange rating
yet, and an unrated socket imposes no limit rather than a made-up one.

**One object, two ends.** The world owns the link table; each component's `connections`
array holds references to the same frozen `Connection` objects. There is exactly one
instance of every link, so the two ends can never disagree.

**Snapping is authoring, not physics.** Grid snapping and automatic socket connection
adjust a transform or a link list _before_ the world sees them. The simulation has no
concept of a grid and produces identical results for snapped and unsnapped placements.

---

## 6. The structural load system

This is ForgeLab's first original physics calculation. It lives in
`packages/sim-core/src/systems/structural.ts`.

### What it does

1. **Establish what is held up.** A component is rooted if it is anchored by the builder or
   its bounding box touches the ground plane. Support then propagates outward from those
   roots along load-bearing connections. Anything it does not reach is _free_, and falls.
2. **Accumulate load downward.** Components are processed in topological order over the
   support graph — everything resting on a component is finalised before the component
   itself — so each member's total load is `own weight + everything above it`.
   `ownWeightN = massKg × gravityMps2`.
3. **Split load between supports by the lever rule.** Each support's share is proportional
   to the reciprocal of its horizontal distance from the supported component's centre of
   mass. For two supports this reproduces the statics answer exactly
   (`R₁ = W·b/L`, `R₂ = W·a/L`); for more it is a documented generalisation that keeps load
   where the mass is and always sums to one.
4. **Convert load to stress.**
   `appliedStressPa = totalLoadN / loadBearingAreaM2`, where the area is the material
   section perpendicular to whichever local axis is closest to world vertical.
5. **Compare against capacity.**
   `allowableStressPa = material.yieldStrengthPa / designSafetyFactor`
   `utilization = appliedStressPa / allowableStressPa`
   The safety factor defaults to **1.0** — compare directly against yield — because a
   design margin is an engineering policy, not a law of physics, and so is opt-in.

Bands, stored as numbers and classified as an enum, never as a colour:

| utilization | status     |
| ----------- | ---------- |
| below 0.70  | `normal`   |
| 0.70 – 1.00 | `stressed` |
| above 1.00  | `failed`   |

### Documented approximations

These are real limitations, stated plainly. None of them are hidden in code.

- **Structural 0.1 member idealisation.** Each part is classified as a _column_ (slender,
  axis near vertical, aspect ratio ≥ 3 — the ACI pedestal rule), a _beam_ (slender, axis
  near horizontal) or a _block_. Columns check axial stress and buckling (Euler
  `P_cr = π²EI/(KL)²`, switching to Johnson's parabola in the inelastic range) with one
  global effective-length factor K (default 1, pinned–pinned) because joints carry no
  rotational-stiffness data. Beams check bending as simply supported between their two
  outermost supports (or as a cantilever), `σ = M/S`. The three utilizations are reported
  separately and the largest governs. Shear, torsion, lateral-torsional buckling and
  combined axial–bending interaction are not modelled.
- **No elastic compatibility.** A statically indeterminate frame is resolved by the
  geometric lever rule above rather than by relative member stiffness.
- **No horizontal equilibrium, overturning check or dynamic amplification.** The centre of
  mass is computed and displayed but nothing tips over yet.
- **Purely lateral connections carry no vertical load.** A cantilever bracket transfers
  nothing in Phase 0 and what it holds is reported as unsupported.
- **A rooted component sheds its load straight into the ground.** A component in contact
  with the ground is treated as fully supported by it and distributes nothing further.
- **Contact is perfectly inelastic and frictionless.** A falling body stops dead when its
  bounding box reaches the ground plane. No restitution, no sliding, no toppling.
- **Held means rigid.** A supported component does not deflect under load.

### Failure events

```ts
interface FailureEvent {
  timestampSec;
  tick;
  componentId;
  connectionId?;
  system: "structural";
  failureType: "yield_exceeded" | "connection_overload";
  measuredValue;
  limitValue;
  unit;
  utilization;
  loadPathComponentIds: readonly ComponentId[];
  cause: string;
}
```

**ForgeLab never returns a bare `FAILED`.** Every failure reconstructs the physical chain:

> `structural-beam "leg-bottom-nx-nz"` carries 327505.1 N carried from platform plus its
> own weight of 1622.3 N, giving 329127.4 N through a load-bearing section of 0.005 m².
> That is a compressive stress of 7.243e+7 Pa, which exceeds the Copper yield strength of
> 6.900e+7 Pa.

`loadPathComponentIds` names the parts whose weight reached the failed element — the load
path the player has to lighten or brace.

Each distinct failure is raised **once**, on the transition into failure, not every tick.
The log is capped at `maxFailureLogEntries` so a long run cannot grow without bound.

**Failure propagation** is a setting. `report-only` (the default) records the failure and
leaves the member carrying load, which keeps results comparable tick to tick. `detach`
makes a yielded member stop supporting anything from the next tick, so what it held becomes
unsupported and falls. `detach` is a deliberately crude stand-in for collapse: there is no
fracture model, no energy release and no debris.

---

## 7. Centre of mass

`computeAssemblyMassProperties` returns total mass and the mass-weighted mean position,
`Σ(mᵢ·rᵢ) / Σmᵢ`, where `rᵢ` is each component's own centre of mass in world space. Each
component's own centre goes through `geometryLocalCenterOfMassM`, which is the origin for
every Milestone 0 primitive because they are all homogeneous and symmetric — and which
stops being true the moment flanged vessels or internal structure arrive.

It is drawn as an optional marker with a plumb line to the ground, because where it sits
relative to the supports is what will decide stability once ForgeLab has rotating
machinery, spacecraft and anything that can tip.

---

## 8. Dynamics backends

Free-body integration sits behind an interface:

```ts
interface DynamicsBackend {
  step(context: DynamicsStepContext): DynamicsStepResult;
}
```

**`BuiltInDynamicsBackend`** is the default and the one every determinism test runs
against. Semi-implicit (symplectic) Euler at the fixed step:

```
v(t+dt) = v(t) + a·dt
x(t+dt) = x(t) + v(t+dt)·dt
```

chosen over explicit Euler because it does not inject energy over long runs, and over RK4
because a uniform gravitational field has no need of it.

**`RapierDynamicsBackend`** (`@forgelab/sim-core/rapier`) is optional and
**non-authoritative**. It exists because the built-in backend has no collision between
components, so falling parts pass through each other. Rapier fills that gap.

It is not, and will not become, the source of physical truth. Support resolution, load
propagation, stress and failure are decided by the structural solver and handed to the
backend as an _input_; all a backend may do is move bodies the solver has already declared
unsupported. Every number ForgeLab reports as a physical measurement is produced without
it. Rapier is loaded by dynamic import, so it costs nothing until switched on, and it ships
as a separate lazy chunk.

---

## 9. Save format

Versioned from day one. `schemaVersion: 1`, plain JSON, no class instances and no engine
internals — the same bytes can sit in browser local storage today and in a `jsonb` column
later with no translation layer.

```json
{
  "schemaVersion": 1,
  "name": "Test Assembly",
  "components": [],
  "connections": [],
  "simulationSettings": { "gravityMps2": 9.80665 }
}
```

**Only authoritative state is stored.** Support modes, loads, stresses and utilizations are
derived, so they are recomputed on load. A save file can never disagree with the solver
about what a structure is doing. The failure _log_ is likewise not stored: it is a record
of a run, not of a design. Loading re-solves, so a failure that is still true reappears
immediately; ones already resolved do not come back.

**Everything goes through `parseAssemblyFile`.** It validates, reports precisely what is
wrong with a malformed file, refuses a file written by a newer ForgeLab rather than
misreading it, and is the single place future migrations will chain.

The browser supports save and load to local storage, and export and import as JSON. None
of it requires a server: the simulation runs entirely in the browser, and always will.
Cloud storage, when it arrives, will store exactly this document and nothing more.

---

## 10. Repository layout

```
forgelab/
  apps/
    web/                     Vite + React + R3F SPA: site pages and the builder.
                             Draws snapshots and worker frames, issues commands.
  packages/
    shared/                  SI units, conversions, Vec3/Quaternion/Transform, snapping.
    materials/               Material database. One place, cited values.
    sim-core/                THE AUTHORITY. Components, solvers, clock, save format,
                             plant physics (src/plant).
    sim-runner/              Headless runs: the worker session protocol and the
                             leaderboard verification scenario. Shared by browser and server.
    reactor-components/      The parametric part catalogue and reference designs.
    test-utils/              World builders, fingerprinting for determinism tests.
    protocol/                Collaboration vocabulary: roles and permissions, ids and
                             topics, presence/event/message schemas, signed envelopes.
    multiplayer/             A member's live project session: verified presence roster,
                             signed collaboration events, pluggable realtime transport.
    voice/                   Channel voice client state machine + LiveKit adapter.
  api-src/                   Server functions: /api/verify, /api/comms/ticket,
                             /api/voice/token, /api/comms/remove-member.
  supabase/
    migrations/              Version-controlled schema, RLS, grants, storage.
    tests/                   RLS tests on PGlite (real Postgres in WASM).
    config.toml              Local stack (supabase start).
  scripts/                   Vercel Build Output generator, local output server.
  e2e/                       Browser acceptance and two-browser collaboration tests.
  docs/
    ARCHITECTURE.md          This file.
    PHYSICS_ROADMAP.md       What exists and what comes next.
    DEPLOYMENT.md            Supabase + Vercel + LiveKit setup, environment, local end-to-end.
    COMMUNICATIONS.md        Channels, voice, chat, presence and shared saves.
    PERFORMANCE.md           Budgets, measurements, known O(N²) paths.
    LAUNCH_REPORT.md         V0.1 launch candidate report.
    material-sources.md      Where every material number came from.
```

Dependencies point one way: `shared` → `materials` → `sim-core` → `sim-runner` /
`reactor-components` → `web` and `api-src`. Nothing in `packages/` depends on `apps/`.
The communication packages form a separate branch: `protocol` → `multiplayer`, and
`voice` on its own; the simulation packages never import them, and they never import
the simulation (`packages/protocol/src/boundaries.test.ts`).

---

## 11. Adding a physics phase

The seams are already in place. A new subsystem should:

1. Add its properties to `MaterialDefinition`, with sources recorded in
   `docs/material-sources.md` first.
2. Add its connection types to the already-reserved list in `connections.ts`.
3. Add a solver under `packages/sim-core/src/systems/`, pure with respect to its inputs.
4. Add a sibling field to `ComponentState` that only that solver writes.
5. Call it from `SimulationWorld.solve()` in a documented order.
6. Add its failure types to `FailureEvent`, with a `cause` that explains the chain.
7. Extend the save schema; bump `schemaVersion` only if a field changes meaning.
8. Write the tests before the renderer.

What must not change: the fixed timestep, SI units, one-way data flow, determinism, and
the rule that no approximation goes in undocumented.

---

## 12. Plant physics (V0.1)

`packages/sim-core/src/plant/` adds the reduced physics a fusion power plant needs. Every
component has a `role` (`vacuum-vessel`, `magnet-coil`, `coolant-pump`, `turbine`, …) and
validated SI `parameters`; `ROLE_PARAMETERS` in `roles.ts` is the single definition of
what each role accepts, its range, and how an interface should display it. The
`PlantSolver` runs once per tick after the structural solve, in this order:

| Subsystem   | Model                                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electrical  | DC nodal analysis per connected island (Gaussian elimination); sources, loads, `R = ρL/A` conductors; proportional curtailment when supply is short.                                                                                            |
| Thermal     | Lumped capacitance per part: generated heat, conduction along links, convection (h = 10 W/m²K) and radiation (ε = 0.3) to ambient; cryoplant load for superconductors.                                                                          |
| Coolant     | Closed loops found from `coolant` links; Darcy–Weisbach with Swamee–Jain friction, parabolic pump curves, operating point by bisection, ε-NTU exchangers. Hot-standby start by default.                                                         |
| Vacuum      | Pressure balance `V·dp/dt = Q_gas − S·p` with pump speed and gas loads (fuelling, exhaust).                                                                                                                                                     |
| Magnetics   | Ideal toroidal winding `B = μ₀NI/2πR`; on-axis finite solenoid; Princeton-D tension for TF coils, thin-shell hoop stress for solenoids; quench above critical temperature (fixed, or NbTi Tc(B) at peak field).                                 |
| Plasma (0D) | Breakdown conditions, current ramp, IPB98(y,2) confinement (tokamaks) or Bohm (linear devices), ohmic, auxiliary and alpha heating, bremsstrahlung, density feedback; Greenwald, Troyon, q95 and β limits; density-limited controlled shutdown. |
| Fusion      | Bosch–Hale D-T reactivity; 20 % alpha / 80 % neutron split.                                                                                                                                                                                     |
| Neutronics  | Exponential attenuation (λ = 0.12 m) through wall, blanket and coils — not transport.                                                                                                                                                           |
| Conversion  | Steam cycle as a fraction of Carnot between loop and condenser temperatures; generator efficiency.                                                                                                                                              |
| Power       | **Net electric = gross generation − house load** (every load plus resistive losses).                                                                                                                                                            |

Failures carry `causeKeys` and a reconstructed `causalChain`, root first, so "pump off →
loss of flow → wall over-temperature → disruption" is one readable story. Tunable modelling
constants (substeps, implicit hose and cable sizes, thresholds) are named and documented in
`constants.ts`.

**Model confidence.** Each snapshot carries `plant.confidence`: _supported_ (inside every
model's documented envelope), _approximate_ (a scaling law extrapolated, neutronics
estimated, a sagging network) or _experimental_ (configurations the models were not built
for: linear plasma devices with heating or fuel, mixed coolants, coils around nothing).
Experimental designs are never ranked. A burning tokamak is at best _approximate_.

## 13. The web application

`apps/web` is a Vite single-page app (react-router). Only the landing page ships in the
main bundle; every page and the builder are split, and the Supabase client is imported
lazily and only when the deployment configures it.

The builder's `EditorStore` (`src/builder/store/editor.ts`) owns an authoring
`SimulationWorld`. Every edit is applied to it through one undoable path, then
`world.solve()` runs, so loads, stresses and the plant's start-up state shown while
building are the engine's answers. Undo/redo stores serialised design files. Snapping
(grid, angle, sockets via a spatial hash) and automatic load-bearing connection happen in
the store before the world sees a placement; Alt overrides them.

Simulate mode serialises the design into a Web Worker running `SimulationSession`
(`sim-runner`). The worker paces fixed steps at 1–10× or flat out and posts compact
frames (transferable typed arrays: transforms and per-part scalars, plus the plant summary,
new failures and history). The scene reads them imperatively each frame; React only
re-renders panels. Nothing on the main thread computes physics in Simulate mode.

Rendering is procedural: each part's body is drawn from its physics geometry with the
engine's dimensions; presentation detail (TF coils as discrete coils, a plasma glow)
stays inside that envelope. Overlays map one engine output each to one hue family.

## 14. Cloud, verification and security

Supabase provides Auth, Postgres and Storage. The schema (`supabase/migrations`) keeps
relational metadata in columns and the design document as JSONB in `project_versions`.
Row-level security is on for every table and privileges are granted **per column**:
browsers can never write owner ids, counters, version numbers, lineage, or the `verified`
flag, and cannot write leaderboard entries at all. Versions are numbered by a trigger;
autosave history is bounded; forks are one atomic `SECURITY DEFINER` function.

Leaderboards accept only server recomputation. `POST /api/verify` receives a project and
version id — never a score — authenticates the caller's JWT, rate-limits, loads the saved
design with the service role, requires ownership and a public project, recomputes the
canonical design hash, runs the fixed 600 s standard scenario with the same deterministic
engine, and writes the run and eligible entries. The secret key exists only in the
function's environment; the build fails if one appears in a `VITE_` variable or in the
browser bundle, and the browser refuses to use one.

Static responses carry a strict CSP (`script-src 'self'`), HSTS, `nosniff`,
`frame-ancestors 'none'`, a restrictive Permissions-Policy and COOP. See
`docs/DEPLOYMENT.md`.

---

## 15. What ForgeLab is not

ForgeLab is **not research-grade**, and no part of it should be described as such. It is an
engineering sandbox built on documented approximations, using nominal handbook material
data that has not been independently verified. Its value is that it is honest about the
difference: every simplification is written down, every material number is sourced, and
every failure explains itself rather than asserting a verdict.
