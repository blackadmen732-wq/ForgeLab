# Reactor Showroom — presentation architecture

The showroom milestone turns a simulated run into something a player can watch: the hall
wakes up when the plant starts, machines hum, plasma glows, and when the physics says a
part failed the player sees and hears that specific failure, can replay it slowly, and can
walk back to its root cause.

**The one rule:** presentation consumes simulation state and failure events. It never
decides that anything failed, never feeds a value back into `sim-core`, and never changes
with graphics settings. Every effect below is triggered by something `sim-core` published.

## Inputs (what the simulation already publishes)

| Input                                          | Source                                                           | Used for                                            |
| ---------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `SessionFrame.plant` (metrics, islands, loops) | `sim-runner` every ≤ 50 ms                                       | facility state, activation stages, audio load       |
| `SessionFrame.vessels[id].plasma`              | plasma phase, thermal energy, fusion power, status               | plasma glow, ignition stage, disruption energy      |
| `SessionFrame.scalars` per component           | temperature, limit, supply fraction, flow, field, disabled, free | component visual states, emitters, overlays         |
| `SessionFrame.transforms`                      | structural solver (free-falling parts move here)                 | collapse, debris spawn positions                    |
| `SessionFrame.newFailures`                     | `FailureEvent` with measured/limit, cause, causal chain          | destruction events, alarms, root-cause view         |
| `PlantConstants`                               | breakdown pressure/field thresholds                              | activation-stage readiness (same numbers as solver) |

Nothing new was added to the simulation for this milestone.

## Module layout (`apps/web/src/presentation/`)

```
presentation/
  settings.ts        local-only options: quality tier, reduce motion, camera-effects intensity,
                     reduced effects, post-processing toggles, grid, volumes (localStorage)
  facility.ts        FacilityState from frames + failures (pure, unit-tested)
  activation.ts      activation stages from real state (pure, unit-tested)
  destruction.ts     FailureEvent → DestructionEvent (pure, unit-tested)
  director.ts        PresentationDirector: subscribes to the editor store, derives the above,
                     publishes PresentationState and an event bus
  replay.ts          run recorder (frames + events), playback clock for failure cinema
  audio/             AudioEventBus → AudioRulesEngine → ComponentAudioEmitter → Web Audio graph
  vfx/               pooled GPU particles (smoke, steam, vapour, cryo, dust, fire, sparks),
                     arcs, shockwave ring, DestructionDirector scene, debris (Rapier)
  camera/            CameraEffectsController (kick, shake, flinch, exposure) and screen crack
  lighting/          FacilityLightingController
  scene/             hall-side React Three Fiber components that read PresentationState
```

The editor store remains the owner of simulation frames. The director is a read-only
observer of it; audio, VFX, lighting and camera are read-only observers of the director.

## Facility states

`BUILD → READY → STARTUP → RUNNING → WARNING → EMERGENCY → FAILURE → POST_FAILURE`

| State        | Condition (all from published values)                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| BUILD        | build mode                                                                                                                         |
| READY        | simulate mode, clock at 0 or paused before any stage completed                                                                     |
| STARTUP      | clock running, at least one activation stage reached, no plasma in flat-top                                                        |
| RUNNING      | a vessel's plasma in ramp-up/flat-top, or power flowing with no plasma configuration                                               |
| WARNING      | any component above 85 % of its temperature limit, structural utilization > 0.85, or a loop below 50 % rated flow, with no failure |
| EMERGENCY    | a failure in the last 6 simulated seconds                                                                                          |
| FAILURE      | a disruption, quench, structural or electrical burn-out failure in the last 2 s                                                    |
| POST_FAILURE | failures raised, nothing new for 6 s                                                                                               |

Lighting, alarms and ambient audio follow this state. FAILURE and EMERGENCY are only ever
entered because `newFailures` contained an event.

## Activation stages

Pressing **ACTIVATE** enters simulate mode and starts the clock; nothing is scripted after
that. The ActivationDirector marks each stage from the state the solver published, and
stalls — naming the solver's own reason — when the physics does not get there:

1. **Electrical** — an island supplies ≥ 95 % of demand.
2. **Cooling** — every loop with a pump carries ≥ 50 % of its rated flow.
3. **Cryogenics** — every superconducting coil is below its limit temperature (V0.1 coils
   start cold; the stage completes as soon as their cryo supply is powered).
4. **Vacuum** — vessel pressure below `PlantConstants.BREAKDOWN_MAX_PRESSURE_PA`.
5. **Magnets** — field at the plasma ≥ the breakdown field.
6. **Fuel & heating** — a powered injector and auxiliary heating delivered.
7. **Ignition** — plasma phase `ramp-up`.
8. **Fusion** — plasma phase `flat-top` with fusion power > 0.

A stalled stage shows `plasma.statusText` ("Waiting to start: pressure 3.1e-1 Pa is
above …"), which is the solver's sentence, not the UI's.

## Destruction events

```ts
interface DestructionEvent {
  eventId: string; // failure key
  simulationTime: number;
  componentId: string;
  worldPosition: Vec3; // component centre from the frame
  worldDirection: Vec3; // outward from the plant centre, or up
  failureType: string; // the sim's failureType
  family: FailureFamily; // electrical | coolant | cryogenic | structural | quench | disruption | thermal | control
  severity: number; // 0..1 from measured/limit and family
  estimatedEnergy: number; // J, presentation estimate from published values (see below)
  temperature: number; // K at the failure tick
  pressure: number | null; // vessel pressure when relevant
  electricalState: "energised" | "de-energised" | "none";
  structuralState: "intact" | "damaged" | "severe" | "fractured";
  fluidType?: string;
  affectedComponentIds: string[]; // load path / causal chain members
  causalFailureId?: string; // root of the chain
}
```

`estimatedEnergy` scales effects only: plasma thermal energy from the last frame before a
disruption, `B²/2µ₀ × coil volume` for a quench, electrical power × 50 ms for a burn-out,
coolant enthalpy flow for boiling. These numbers never leave the presentation layer.

### Families and what they look like

| Sim failure                                                                                 | Family     | Presentation                                                                                          |
| ------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `over_temperature` on a conductor                                                           | electrical | arc flash between the conductor's ends, sparks, ozone-blue light, smoke from insulation (combustible) |
| `supply_shortfall`                                                                          | electrical | brown-out: fixtures dip and flicker, no sparks                                                        |
| `coolant_boiling`                                                                           | coolant    | steam venting from the loop's hottest part, pressure-relief hiss                                      |
| `loss_of_flow`                                                                              | coolant    | pump spins down, flow indicators stop, amber alarm                                                    |
| `quench` / over-temperature on a magnet coil                                                | quench     | helium vapour venting from the coil (cold white, falls), crack-bang, field glow collapses             |
| `disruption`                                                                                | disruption | plasma flash then extinction, restrained shockwave light, vessel ring, dust                           |
| `yield_exceeded`, `buckling`, `bending_yield`, `connection_overload`, `magnetic_overstress` | structural | pre-fractured debris, dust, metal stress audio; parts the solver releases fall under its own physics  |
| other `over_temperature`                                                                    | thermal    | heat shimmer, dull red glow, smoke only when the part is combustible                                  |
| `interlock_trip`                                                                            | control    | alarm tier change and lighting only                                                                   |

No family produces a fireball or a mushroom cloud: a fusion plant holds grams of fuel and
stops when it is disturbed. Fire appears only where a plausible combustible exists
(insulation, oil, cabling) and only with a heat source above its ignition temperature.

### Secondary propagation — limitation

Debris, shockwaves and camera cracks are presentation. A fragment that visually strikes a
neighbouring machine does **not** damage it; only a failure the simulation raises does.
If a cascade happens, it is because `sim-core` propagated it (causal chains, supply loss,
field collapse). A physically coupled debris → damage model belongs in `sim-core` and is
out of scope here.

## Damage progression and materials when hot

Every part has a **condition** read from published values (`presentation/damage.ts`):
normal → stressed (≥ 70 % of its structural allowable or wall yield, within 15 % of its
temperature limit) → local damage (a failure raised on it, over its limit, cavitating) →
severe (15 % over its limit, under half its pump head) → ruptured / failed (pipe rupture,
quench, structural or casing failure, burned out) → destroyed (it broke up). The Inspector
shows the condition and the value behind it; the Normal view darkens and dulls damaged
surfaces. Nothing here decides a failure.

The **Normal view stays realistic**: failed parts are no longer flagged red there (the
engineering views and the Failures view still do). Instead each material shows its own
response to heat, chosen by its library response class with thresholds from its own data:

| Response       | Materials                   | What it looks like hot                                                              |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| steel          | carbon and stainless steels | oxide temper colours (straw → brown → purple → blue → grey, ~200–360 °C), then glow |
| copper         | C11000, OFHC                | tarnish to reddish Cu₂O, then black CuO; glow only above the Draper point           |
| light alloy    | aluminium alloys, beryllium | little change; low emissivity keeps glow faint (it melts before it visibly glows)   |
| refractory     | tungsten, molybdenum        | full black-body glow above ≈ 798 K                                                  |
| char           | G-10CR, Kapton, XLPE        | scorch then char between its service limit and ignition temperature                 |
| ceramic        | alumina, graphite, SiC      | glow, no oxide colours                                                              |
| superconductor | NbTi, Nb₃Sn, REBCO          | no surface change: a quench shows as resistive heating inside the winding           |

Internal regions in a cutaway use their own material's response at the part's lumped
temperature, so insulation chars and copper windings blacken while the steel case only
takes its temper colours.

**Damage marks** stay on surfaces until the run is reset: scorch where an arc struck, soot
above burning insulation, frost where cold helium vented, cracks where a member failed, a
torn opening where a pipe ruptured. Each is a decal projected onto the part's surface at
the destruction event's site (`vfx/marks.ts`); the count is a quality-tier budget.

## Audio

`presentation/audio/`: the director's events are the bus; `rules.ts` (pure, tested) turns
them into actions; `engine.ts` plays them through Web Audio:

```
director events ─► rules ─► emitters (one per running machine, PannerNode at the mesh)
                          ─► failure one-shots (HRTF, at the failure's position)
                          ─► alarm patterns (hall PA, not spatial)
buses: ambient ─┐
       machinery┴─► duck ─► master ─► limiter ─► output      (+ convolution hall reverb send)
       alarms, failures, interface ───────► master
```

- **Ambient** — HVAC (filtered brown noise with slow movement) and mains hum; on POWER
  LOSS the fans spin down and the hum stops.
- **Machinery** — pump motor and water flow, turbine whine and steam, generator hum,
  turbomolecular whine, magnet cold-box compressors, beam-heater buzz. Level and pitch
  follow each machine's activity (spin-up faster than coast-down); failed machines go
  silent.
- **Alarms** by tier — ADVISORY single chime, CAUTION two-tone chime every 5 s, WARNING
  1 Hz beep, EMERGENCY rising whoop.
- **Failure families** — arc crackle and breaker bang (electrical), relief thump and long
  steam hiss (coolant), boom and helium venting (quench), crack, ringing vessel and thud
  (disruption), groan then crash (structural), relay clicks (brown-out, control).
- **Priority and ducking** — at most 8 failure voices, highest priority first; violent
  events duck machinery and ambience by 4–14 dB and let them recover.
- Everything is synthesized; the context starts on the first gesture; volumes and mute
  are local settings. Plasma is never given a "sound" of its own.

## Debris

Three tiers, all pooled:

- **A** — up to 24 Rapier rigid bodies per event (quality-dependent), convex hulls of the
  pre-fractured pieces, CCD on, contact-force events drive impact sounds and camera-crack
  checks.
- **B** — up to 200 simplified instanced chunks with analytic ballistic motion and a
  floor bounce.
- **C** — GPU instanced particles for dust and grit.

Rapier is WebAssembly; the site's Content-Security-Policy allows `'wasm-unsafe-eval'`
(WebAssembly compilation only — JavaScript `eval` stays blocked). Fragments are faceted
chunks sized from the failed part and coloured by its material; a part breaks up once per
run however many failures it raises.

Hot parts glow in the Normal view: above the Draper point (≈ 798 K) the published
temperature drives a blackbody-like emissive ramp from dull red to yellow-white.

A camera protection collider (a thin sensor box in front of the camera) reports Tier A
contacts. A screen crack appears only when a Tier A fragment actually hits it above an
impulse threshold; the crack originates at the projected impact point and is cleared on
reset.

## Replay and failure cinema

The recorder keeps every frame of the run (~5 min at 20 fps) together with what the
presentation showed with it (facility state, stages, machine states). **Watch failure**
(next to the root-cause chain) pauses the live run and opens the replay 5 s before the
root failure:

- pause, 0.25×, 0.5×, 1×, 2×, and a scrubber with a marker per failure;
- cameras: **Free**, **Follow** (the orbit target tracks the watched part, which may be
  falling), **Root cause** (frames the part that failed first);
- failures are re-issued as the playhead passes them, so their effects play again at
  replay speed — effects run on presentation time, which the replay scales (pause
  freezes smoke and debris mid-air);
- **Reset run** and **Return to Build** are on the panel; Return to Build restores the
  design exactly as it was before activation (the simulation ran in the worker on a copy).

The viewport shows recorded frames through a store override (`setReplayFrame`); nothing
is re-simulated and the worker is only paused.

## Root cause

Under the activation strip after a failure: `ROOT CAUSE → … → final failure`, the
longest causal chain the solver built, root first. Each step is clickable: it selects and
frames the part and, in replay, jumps to just before that failure.

## Post-processing

`PostFx`: bloom on genuinely bright things (fixtures, plasma, arcs, sparks, flashes), a
restrained vignette, then tone mapping — only on tiers that allow it and when the viewer
keeps "Glow on bright lights" on. Heat distortion and replay depth of field are not
implemented yet.

## Quality tiers

`LOW / MEDIUM / HIGH / ULTRA` change particle budgets, debris tier-A counts, shadow map
size, post-processing and pixel ratio. They never change the simulation step, solver
fidelity or any published number. `reduceMotion` (and the OS setting) disables shake and
kick; `cameraEffectsIntensity` scales them; `reducedEffects` removes flashes and strobes.

## Test scenarios

`reactor-components/src/scenarios.ts` holds six designs with one deliberate engineering
mistake each — magnet quench, electrical bus fault, coolant boiling, structural collapse,
plasma disruption (Greenwald), and a multi-system cascade (pump off → wall overheats →
disruption). `scenarios.test.ts` proves the simulation raises each failure.

`e2e/showroom.mjs` (in CI, against the production build) checks the empty hall, the
reference plant reaching every stage to fusion with machine sound, then for every
scenario: the simulation raises the family, its own effect is on screen, the facility is
in an alarm state, failure cinema opens at the root cause and exits cleanly, and Return
to Build restores the undamaged design with no glass cracks left. It also checks the six
scenarios do not all look the same.

## Developer effects panel

`/app?debug` shows a dashed panel with facility, alarm, audio level and live particle /
debris counts, buttons that load each fault scenario, and "preview" buttons that play an
effect recipe on the selected part **without** any simulated failure (for tuning only; it
never changes facility state and is not in the product UI).

## Known limitations

- Debris cannot damage other parts (see "Secondary propagation").
- Software GL (SwiftShader, llvmpipe) starts on LOW and renders ~1 frame/s; replay and
  effects then run slower than their nominal rate because frame steps are capped.
- Pre-fractured pieces are generated per failure from the part's envelope; authored
  break groups per product arrive with the finished-product visuals (R4).
