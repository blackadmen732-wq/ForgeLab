# Phase A — procedural coolant pump

This milestone extends the existing machine renderer on the developed
`ccr-3bd0d75a-5yspev` branch (`d9d6e1d`). The preceding industrial lighting work is
preserved in `a02e4bd`. The component catalogue, simulation, connections, document
schema, collaboration and saving infrastructure are unchanged.

## Construction

`scene/coolantPump.ts` builds a vertical in-line pump with a scroll casing, inspection
cover, bolted service flanges, finned motor, fan cowl, windowed coupling guard, power
terminal enclosure, signal connector and an open-channel skid with mounting pads.
The former decorative rotor above the motor is replaced by a coupling inside the guard.
Its movement and indicator still consume the existing simulation presentation state.
An unpowered machine must remain stationary.

The existing component definition supplies the two-metre envelope and all five socket
positions/directions. Fluid fittings use the authoritative port bore (0.66 m diameter
for the default pump). No independently defined UI compatibility or hydraulic model is
introduced. The casing remains centred on the existing schematic impeller region; the
motor remains aligned with the existing internal motor region. Internals retain their
existing SCHEMATIC identification. This is a visual assembly, not a manufacturing drawing.

`scene/industrialGeometry.ts` supplies metre-based rounded housings, hollow bevelled
flanges, batched hex bolt patterns, open-bore curved conduits and socket-aligned fittings.
The pre-existing primitive functions moved unchanged to `scene/machineGeometry.ts` and
remain re-exported from `machines.ts`, so other machines and internals keep their API.

The static pump has 18,460 triangles across three batched surfaces, using the existing
shell/trim/accent material and disposal paths. Repeated fasteners clone a shared CPU
prototype before merging; they do not create a mesh per bolt. The animated coupling and
status lamp remain separate. There are no new libraries, textures or network downloads.
The envelope check allows 10 mm for fittings; flange bolt heads protrude at most 7.5 mm
at each fluid interface. Engineering scale and collision bounds are unchanged.

## Asset provenance and licence record

| Asset                                       | Source                                                              | Rights / dependency                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Pump geometry, fittings, skid and coupling  | Repository-authored procedural TypeScript in this milestone         | No imported model or third-party asset licence; follows the repository's code rights |
| Bevelled housing primitive                  | Existing Three.js `RoundedBoxGeometry` dependency                   | Three.js MIT licence, retained in the dependency distribution                        |
| Pump surfaces and reflections               | Existing ForgeLab procedural materials and lighting                 | Generated locally; no external image needed                                          |
| Optional deployment HDRI and floor textures | Existing Poly Haven catalogue, documented in [ASSETS.md](ASSETS.md) | CC0; optional, not needed for this milestone                                         |

No Meshy, Tripo, paid export service, Blender installation or asset bucket is required.
This record does not assign a new licence to the project itself.

## Verification

```bash
pnpm verify
pnpm format:check
pnpm vercel-build
node scripts/serve-output.mjs 3000
```

In another shell:

```bash
E2E_SHOTS=/tmp/forgelab-pump node e2e/pump.mjs http://localhost:3000
```

For a system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.
The focused browser check uses the production editor with no cloud or external visual
assets. It exercises placement from the parts drawer, real viewport picking, socket
overlay positions, transforms and undo/redo, file serialization, browser draft reload,
cutaway inspection, repeated placement/removal, standalone activation and operation in
the existing reference plant. It verifies that stopping simulation restores the exact
build document. Optional screenshots cover selected, unselected, port, interior and
operating views.

Five geometry tests cover finite bounds, triangle budget, unchanged engineering data,
open flange bores in three axes and coupling placement/scaling. The existing machine
catalogue tests continue to exercise every model after the primitive extraction.

### Results in the cloud workspace

- `taskset -c 0 pnpm verify`: passed type checking, lint, all 607 tests in 69 files
  (including the three simulation benchmarks), and the production build.
- `pnpm format:check` and `pnpm vercel-build`: passed. The build reports the existing
  large-chunk warning and uses local-only mode because cloud credentials are not configured.
- `e2e/pump.mjs`: passed with system Chromium and SwiftShader, with no page or console
  errors. Socket positions are checked against the actual insertion position supplied
  by the editor.
- Two cycles of adding 12 pumps increased live GPU geometries from 111 to 171 and returned
  to 111 after deletion. This checks resource release, not large-facility frame rate.
- The unpowered pump had zero activity. In the reference plant the coupling rotated from
  simulation-derived activity; stopping restored the exact pre-run design hash.
- Exterior, selected, socket, schematic cutaway and operating screenshots were captured
  and visually inspected in the running production editor.

Evidence is saved outside the checkout in `/workspace/artifacts/forgelab-pump/`, including
`original.png`, `pump-hero.png`, `pump-selected.png`, `pump-ports.png`, `pump-cutaway.png`,
`pump-operating.png`, `verification.log` and `browser-check.log`.

Run CPU timing benchmarks without competing software-rendering browsers. A constrained
cloud runner can use `taskset -c 0 pnpm verify` to keep Vitest concurrency within its CPU
quota without changing any assertions. Software Chromium verifies rendering and behaviour;
it cannot establish a hardware GPU frame-rate claim. Cloud acceptance and multiplayer
suites need the separate Supabase/LiveKit stack described in [COMMUNICATIONS.md](COMMUNICATIONS.md).
Those cloud suites were not run for this milestone; the available local Supabase tooling
cannot start this repository's configured stack. The existing SQL policy and collaboration
unit tests did pass in `pnpm verify`. No backend or realtime configuration was changed.

Later machines, routed construction assets, placement UX and deeper interior work remain
the subsequent phases of the brief.

## Changed files

All scene paths below are under `apps/web/src/builder/scene/`.

| File                      | Change                                                                    |
| ------------------------- | ------------------------------------------------------------------------- |
| `coolantPump.ts`          | Detailed static assembly and animated coupling geometry                   |
| `industrialGeometry.ts`   | Reusable dimensioned housings, flanges, fasteners and conduits            |
| `machineGeometry.ts`      | Existing primitives extracted without changing their behaviour            |
| `machines.ts`             | Dispatch the existing pump type to its new builder; preserve other models |
| `meshes.tsx`              | Use the enclosed coupling and reposition the pump's status lamp           |
| `coolantPump.test.ts`     | Five geometry and engineering-contract checks                             |
| `e2e/pump.mjs`            | Focused production-editor browser verification and screenshots            |
| `docs/PROCEDURAL_PUMP.md` | Construction, provenance, validation and scope record                     |
