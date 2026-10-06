# ForgeLab

A browser-based 3D reactor and energy-system construction sandbox.

> We provide the components and physics. The player decides what to build.
> Reality decides whether it works.

ForgeLab is an engineering sandbox, not a game about engineering. There is no campaign, no
character, no tech tree and no balanced stats. You build things out of real components with
real material properties, run the simulation, and find out whether your design stands up.
When it does not, ForgeLab explains the physical chain that broke it.

**This repository is at Milestone 0: Simulation Foundation.** Gravity and structure work.
Fusion physics does not exist yet, and neither do accounts, cloud saves, leaderboards or
multiplayer. See [`docs/PHYSICS_ROADMAP.md`](docs/PHYSICS_ROADMAP.md) for what comes next.

---

## What works today

- A deterministic, fixed-timestep simulation engine that runs entirely in your browser.
- Earth gravity, `g = 9.80665 m/s²`, with unsupported components falling and supported
  components transferring load into their supports.
- A structural load system: support resolution, load propagation, lever-rule reaction
  splitting, stress utilization against real material yield strengths, and failure events
  that explain themselves.
- A material database of five metals with sourced, grade-specific properties.
- Four components — structural beam, structural platform, generic reactor chamber, generic
  equipment block — that you can place, move, rotate, duplicate, delete and snap together.
- Assembly mass and centre of mass, with an optional marker in the workspace.
- A versioned save format with local save/load and JSON export/import.
- A **cascading multi-physics failure solver** (reduced models, labelled as such). One
  failure changes the physical environment, and each nearby component's own physics
  decides whether it fails in turn: heat, flame, hot gas, arcs, coolant jets, gas
  accumulation, hot debris, magnet quench and plasma disruption. Every event records its
  physical causes, the interface separates root cause from the most dramatic event, any
  event can be replayed, and a hazard view shows what each part is receiving. See
  [`docs/CASCADE.md`](docs/CASCADE.md).

## Getting started

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

Other scripts:

```bash
pnpm test       # simulation test suite (Vitest, Node - no DOM)
pnpm typecheck  # TypeScript across every package and the app
pnpm lint       # ESLint
pnpm build      # production build of the web workspace
pnpm verify     # all of the above, in order
```

Requires Node 20+ and pnpm 10+.

## Trying it out

The workspace opens on a starter assembly: a steel platform on four legs with a reactor
chamber on the deck. Everything is comfortably within capacity.

To make something fail:

1. Click the reactor chamber to select it.
2. In the inspector, raise **Contents (kg)** — this is mass the geometry does not model,
   such as inventory or internals.
3. Watch utilization climb through `stressed` at 0.70 and `failed` past 1.00. The legs turn
   red and the failure log explains exactly how much load arrived, through what section,
   and which material limit it crossed.

Or swap the legs to **Copper** and watch a far smaller load do the same thing — copper's
69 MPa annealed yield is simply the wrong material for a structural column, and the solver
works that out on its own.

The **Overload demo** button in the Scenes panel loads that case directly.

To watch a cascade, load **Cascade — unprotected** from Scenes, set speed to 30× and press
Play. A single degraded joint on a switchgear bus is the only fault. Open the **Cascade**
tab to follow it, click any event to replay to it, and switch the toolbar's **Hazard view**
to see radiant heat, hot gas and gas clouds. Then load **Cascade — protected**: the same
fault, a properly engineered plant, and the chain stops at the breaker.

## How it is put together

```
apps/web/                  React + React Three Fiber workspace. Draws simulation
                           snapshots and issues commands. Contains no physics.
packages/shared/           SI units, conversions, Vec3/Quaternion/Transform maths.
packages/materials/        Material database. One place, cited values.
packages/sim-core/         THE AUTHORITY. Components, solvers, fixed-timestep clock,
                           failure events, save format. No React, no Three.js, no DOM.
packages/reactor-components/  The four built-in components.
packages/test-utils/       World builders and deterministic fingerprinting for tests.
docs/                      Architecture, physics roadmap, material sources.
```

The rule that matters: **`sim-core` decides what is physically true, and everything else
reads from it.** Rendering never contains reactor physics, and UI state never determines
physical truth. This is enforced by a test that scans the source of every simulation
package and fails the build if any of them imports a renderer, touches the DOM, or uses a
non-deterministic source.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything in
`packages/`.

## Honesty about the model

ForgeLab is **not research-grade** and should never be described as such.

The structural model treats every member as a short column in pure compression. It does not
compute bending, shear, torsion or buckling — which means a slender steel column reads far
stronger than it really is, because real slender members buckle long before they yield.
That is the largest gap in the current model and the first thing the next phase should
close. The full list of approximations is in §6 of `docs/ARCHITECTURE.md`, and every
material number is sourced with its caveats in `docs/material-sources.md`.

What ForgeLab does promise is that the simplifications are written down, the material data
is cited, and a failure always explains itself instead of asserting a verdict.

## Licence

Not yet determined.
