# ForgeLab V1 — status against the 80–90 % milestone

Audited from the code (not from older reports) at commit `439fd82` on
`ccr-1795abcb-q03im7`, then kept current as work lands. Status keys:

- **COMPLETE**: implemented, tested and documented to the milestone's bar.
- **PARTIAL**: a real foundation exists; the milestone asks for more.
- **MISSING**: nothing meaningful exists yet.

The rules in `CLAUDE.md` apply to everything below. "Evidence" names where the existing
work lives, so nobody rebuilds it.

## Baseline and repository (0–1)

| #   | Item                       | Status  | Evidence / remaining                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Green baseline             | PARTIAL | Typecheck, lint, build and all unit/integration tests pass; acceptance and showroom E2E pass. CI run #31 failed collaboration step 08 ("speaking is shown"): Chromium's default fake microphone is a once-a-second beep that noise suppression attenuates and the SFU's speaker detection only sometimes accepts. Fixed by a deterministic speech-shaped fake microphone (`e2e/speech-wav.mjs`) — the assertion is unchanged. |
| 1   | Branch / release structure | PARTIAL | The product lives on `ccr-1795abcb-q03im7`; the default branch is the old Milestone 0 branch. Promotion plan in `docs/RELEASE.md` (needs the repository owner).                                                                                                                                                                                                                                                               |

## Catalogue, visuals, animation, internals, materials (2–8)

| #   | Item                               | Status  | Evidence / remaining                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Second-wave machine catalogue      | PARTIAL | 21 parametric parts (`reactor-components/src/builtin.ts`) with products, typed ports, ratings, internals. Missing: dedicated cryoplant, magnet power supply / dump resistor / quench detector, valves, manifold, pressurizer, relief valve, cryostat, divertor, RF heating, capacitor bank, switchgear, supports/trays/racks. |
| 3   | Finished machine look              | PARTIAL | Procedural finished models for most machines (`scene/machines.ts`): flanges, feet, ribs, motors, terminal boxes. Missing for new parts; no LOD system yet.                                                                                                                                                                    |
| 4   | State-driven animation             | PARTIAL | Visual states OFF/STARTING/RUNNING/HIGH_LOAD/WARNING/FAILING/FAILED/SHUTTING_DOWN (`presentation/visualState.ts`); rotors ease up and coast down; lamps; precursor shudder. Missing: valves, breaker mechanism, cryoplant machinery, magnet charging state, NBI beam tied to delivered power.                                 |
| 5   | Reduced real internal assemblies   | PARTIAL | Bespoke schematic internals for 9 machines (`scene/internalModels.ts`) labelled SCHEMATIC. Missing: magnet winding pack detail, transformer.                                                                                                                                                                                  |
| 6   | Internal regions physically matter | MISSING | Regions are descriptive (`products.ts` internals). Solver uses one material per component.                                                                                                                                                                                                                                    |
| 7   | Deeper material curves             | PARTIAL | 25 solids + 7 fluids with sources/confidence (`materials/library.ts`, `fluids.ts`); EN 1993-1-2 steel derating and CRC copper resistivity curves are live in the solver. Missing: stainless, aluminium, titanium, tungsten, molybdenum curves.                                                                                |
| 8   | Superconductor engineering margin  | PARTIAL | NbTi Tc(B) critical surface (Bottura), Nb3Sn conductor option; quench detection/dump. Missing: Jc(B,T), current-sharing temperature, REBCO surface.                                                                                                                                                                           |

## Systems physics (9–20)

| #   | Item                             | Status                              | Evidence / remaining                                                                                                                                                                                |
| --- | -------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Player-built cryogenic network   | PARTIAL                             | `cryo` connection type exists; refrigeration is a lumped coil parameter (`cryoCapacityW`, Carnot fraction, plant power), helium boil-off. Missing: a cryoplant component and supply/return network. |
| 10  | Magnet charging lifecycle        | PARTIAL                             | Inductance, ½LI², detection delay, dump decay, boil-off. Missing: charging ramp from a voltage-limited supply (current jumps to operating value today).                                             |
| 11  | Free-form vacuum chamber builder | MISSING                             | Chambers are whole parts (`tokamak-vessel`, `reactor-chamber`).                                                                                                                                     |
| 12  | Custom coil construction         | MISSING                             | Coils are `tf-coil-set` (ideal toroid) and `solenoid-coil`.                                                                                                                                         |
| 13  | Geometry-derived magnetic field  | MISSING                             | Analytic toroid/solenoid fields only (`plant/magnetics.ts`).                                                                                                                                        |
| 14  | Experimental reactor detection   | PARTIAL                             | Model confidence supported/approximate/experimental per subsystem (`plant/confidence.ts`). Plasma model still keys on vessel role and a tokamak flag.                                               |
| 15  | Geometry-aware plasma            | MISSING                             | 0D plasma (`plant/plasma.ts`).                                                                                                                                                                      |
| 16  | Plasma presentation from state   | PARTIAL                             | Glow from temperature, unrest wobble near limits, disruption sequence. Fixed torus shape.                                                                                                           |
| 17  | Fluid failure physics            | PARTIAL                             | Pressure boundaries, IF97 saturation, NPSH cavitation, Lamé hoop rupture. Missing: relief valve, pressurizer, blowdown/inventory loss.                                                              |
| 18  | Component-specific failures      | PARTIAL                             | over_temperature, yield/buckling, quench, magnetic overstress, pipe rupture, cavitation, loss of flow, supply shortfall, disruption. Missing: bearing, overspeed, transformer faults, vacuum leaks. |
| 19  | Failure visual quality           | COMPLETE for this milestone's scope | Staged sequences, precursors, distinct media, marks, breaches, audio scores (docs/SHOWROOM.md). Continue per new failure type.                                                                      |
| 20  | Secondary damage as physics      | MISSING                             | Debris is presentation only (documented).                                                                                                                                                           |

## Building UX (21–22, 32–46 extension)

| #                | Item                                  | Status  | Evidence / remaining                                                                                                                                                             |
| ---------------- | ------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21               | Mirror / arrays / assemblies / routes | PARTIAL | Duplicate, multi-select, socket snap, auto-routing on rack heights (`scene/routing.ts`). Missing: mirror, arrays, groups/assemblies, waypoints, obstacle avoidance, measurement. |
| 22               | Preflight                             | MISSING |                                                                                                                                                                                  |
| 7–10 (CLAUDE.md) | Compatibility in sim-core             | PARTIAL | `checkPortCompatibility` (sim-core `ports.ts`) with reason + warnings, used by the UI. Missing: machine-readable codes, explicit three-state result.                             |
| 23               | Controls (PID etc.)                   | PARTIAL | Sensors and interlocks (trip on threshold). Missing: PID, valve position, ramp control.                                                                                          |
| 24               | Tritium / blanket viability           | PARTIAL | D-T fuel mix and neutron heating of blanket. Missing: TBR estimate, inventory, sustainability warning.                                                                           |
| 25               | Lifetime foundation                   | MISSING |                                                                                                                                                                                  |

## Sharing, collaboration, performance, production, docs (26–31)

| #   | Item                        | Status  | Evidence / remaining                                                                                                                    |
| --- | --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 26  | Share runs and failures     | MISSING | Design publish/fork/like/leaderboard with server-recomputed scores exist; runs are not artifacts.                                       |
| 27  | Failure gallery / discovery | PARTIAL | Discover with sorts and search. Missing: failure and experimental filters.                                                              |
| 28  | Collaboration UX            | PARTIAL | Channels, voice, chat with component mentions, presence, roles, invites, shared saves, conflict detection. Missing: Share View, Follow. |
| 29  | GPU / large designs         | PARTIAL | CPU budgets in CI (`sim-runner` benchmark); quality tiers. Missing: hardware GPU profiling, LOD, instancing of repeated parts.          |
| 30  | Production readiness        | PARTIAL | Architecture and deployment scripts exist (docs/DEPLOYMENT.md). Needs account approval to provision real services.                      |
| 31  | Current-state report        | PARTIAL | This file; `docs/LAUNCH_REPORT.md` is stale (5 materials).                                                                              |

## Extension items (32–96) — summary

COMPLETE or largely present: replay with failure cinema and root-cause chain (47 partial:
chain, not a branching graph), damage condition stages (50 partial: no transition history),
design state ≠ run state (93, protected and tested by the showroom E2E), determinism (65,
tested), autosave/versions (92 partial), save versioning with a migration path (64 partial:
schema v1, no historical fixtures yet), engineering views (temperature, stress, flow, power,
field, internals), command palette (71 partial), model confidence (62 partial), causal
chains (24/47 partial), run report (87 partial), "why didn't it start" stage stall reasons
(88 partial), personal best and leaderboards.

MISSING: universal component validator (33), mechanical shaft dynamics with inertia (35;
shaft links exist as a network), connections with their own physical limits beyond pipe
geometry (37 partial for pipes and bus bars), probes (45), per-component time-series
history (46 partial: plant-level timeline only), branching causal graph (47), engineering
failure timeline (48 partial), best diagnostic view suggestion (49 partial: Look inside),
thermal distortion (53), plasma–wall contact location (54), breakdown visual sequence (55
partial: activation stages), power-flow and coolant-flow animation (57–58), structural
load-path visualisation (43), foundation loads (61), simulation version on runs and scores
(63), visual regression tests (66), design comparison and history (76–80), Share View /
Follow (81–82), co-editing design (83), systems/zones hierarchy (84), schematic view (85),
system health overview (86 partial: activation strip), moderation tooling (91: reports table
exists, no admin UI).

## Work order for this milestone

1. Baseline green, CLAUDE.md, this audit, release plan.
2. Port compatibility codes and three states; preflight.
3. Pattern tools: radial array, linear array, mirror.
4. Geometry-derived magnetic field (discretised Biot–Savart), custom coils, field probe.
5. Free-form chamber segments; derived plasma region; experimental/unsupported confidence.
6. Magnet charging; cryoplant network; relief and blowdown.
7. Shared runs and failures; Share View / Follow; current-state report.

Each step lands as small green commits; this file is updated as items change status.
