# ForgeLab

**Build anything. Physics decides.**

ForgeLab is a browser-based 3D engineering sandbox for designing, simulating, breaking and
improving fusion power plants and the machines around them. You place parametric parts in
an open workspace, connect power, coolant, steam and control, and run the design. A
deterministic, real-units simulation decides whether it stands up, makes power, or fails —
and explains the chain of causes when it does.

ForgeLab is a sandbox built on documented, reduced models. **It does not validate real
reactor designs**, and nothing in it should be described as research-grade.

**Status: V0.1 launch candidate.** See [`docs/LAUNCH_REPORT.md`](docs/LAUNCH_REPORT.md).

---

## What it does

- **Open 3D builder.** Empty workspace by default; 21 parametric parts (vessels, TF coils,
  solenoids, blankets, heaters, fuelling, pumps, pipes, heat exchangers, turbines,
  generators, grid, bus bars, breakers, sensors, interlocks, structure). Move/rotate
  gizmos, grid/angle/socket snapping (Alt overrides), multi-select and box select,
  duplicate, hide/isolate, cutaway and x-ray, perspective/orthographic, standard views,
  undo/redo, command palette (Ctrl K) and a shortcut overlay (?).
- **Physics that decides.** Structural 0.1 (axial, Euler/Johnson buckling, beam bending),
  DC electrical networks, lumped thermal, coolant loops, vacuum, magnetics, a 0D plasma,
  D-T fusion, blanket heat, steam cycle and **net electric = gross − house load** — all in
  `@forgelab/sim-core`, the only authority on physical truth.
- **Simulate mode** runs the plant in a Web Worker at 1–10× or flat out, with overlays for
  stress, temperature, power, coolant, magnetic field, plasma and failures, live
  sparklines, and failures you can click to fly to, each with its causal chain.
- **Model confidence** on every result: Supported, Approximate or Experimental.
- **Cloud (optional):** accounts, autosave with version history, publish, fork with
  lineage, likes, discover, public profiles, thumbnails and avatars.
- **Server-verified leaderboards:** the server reruns a fixed 10-minute scenario on the
  saved design; numbers reported by a browser are never ranked.
- **Guest friendly:** no account needed to build and simulate; designs autosave locally.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173 — local-only mode without Supabase variables
```

Open **Start Building → Interactive starter**: a fusion plant with one problem. Run it,
read the failure chain, fix it, run it again.

| Script              | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm test`         | engine, components, runner, verification, RLS and web-store tests |
| `pnpm typecheck`    | TypeScript across packages, server function and app               |
| `pnpm lint`         | ESLint (incl. React Compiler rules)                               |
| `pnpm build`        | production SPA                                                    |
| `pnpm vercel-build` | SPA + `/api/verify` as a Vercel Build Output, with a secret scan  |
| `pnpm verify`       | typecheck, lint, test, build                                      |

Cloud setup, deployment and the end-to-end acceptance test are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Requires Node 20+ (22 recommended) and pnpm 10.

## Layout

```
apps/web/                    Vite + React + React Three Fiber SPA (site + builder)
packages/shared/             SI units and vector maths
packages/materials/          Sourced material data
packages/sim-core/           THE AUTHORITY: structure, plant physics, save format
packages/sim-runner/         Worker session protocol and leaderboard verification
packages/reactor-components/ Parametric part catalogue and reference designs
api-src/                     POST /api/verify (server recomputation)
supabase/                    Migrations (schema, RLS, grants, storage) and RLS tests
scripts/, e2e/               Vercel build output, local server, acceptance test
docs/                        Architecture, physics roadmap, deployment, performance
```

The rule that matters: **`sim-core` decides what is physically true; everything else reads
from it.** An architecture test fails the build if a simulation package imports a
renderer, touches the DOM, or uses a non-deterministic source. Read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing `packages/`.

## Honesty about the model

Every model is reduced and documented: lumped temperatures, 0D plasma with empirical
scaling laws, exponential neutron attenuation, ideal coil fields, single-phase coolant.
Approximations are listed in `docs/ARCHITECTURE.md` (§6, §12), sources for every material
number in `docs/material-sources.md`, and the model-confidence label on each run says how
far a design is from the models' comfort zone.

## Licence

Not yet determined.
