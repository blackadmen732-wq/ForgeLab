# ForgeLab visual work completed

The aim is a browser engineering sandbox with convincing machinery, readable interiors,
good lighting and useful construction controls. All work below extends the existing game.
The current development line began at `d9d6e1d` on `ccr-3bd0d75a-5yspev`, the most developed
branch inspected during setup. Earlier branches and their work were preserved.

## Environment and lighting

The cloud workspace can install the pinned pnpm dependencies, run the verification commands,
build the application and inspect the production editor with Chromium. Three.js builds the
machines directly; a Blender installation on the player's laptop is unnecessary.

The lighting pass in `a02e4bd` added balanced warm/cool illumination, clearer metal reflections,
finer procedural surface wear and shadows that fit the current design and visible floor.
Shadow bounds follow distant placements and inspection transforms. It also fixed a white-floor
regression when switching quality tiers and retained edge smoothing through post-processing.
Details and earlier verification are in [FRONTEND_LIGHTING.md](FRONTEND_LIGHTING.md).

## Coolant pump — Phase A

Commit `e75640a` replaced the simple pump model with a scroll casing, finned motor, bolted
open-bore flanges, coupling guard, power enclosure, inspection cover and mounting skid.
The coupling sits inside the guard and moves from existing simulation activity. It remains
inactive without power/flow. The pump keeps its two-metre size and five engineering sockets.

The static model has 18,460 triangles in three batched surfaces. Verification passed all
607 tests at that milestone, plus editor picking, socket alignment, transforms, undo/redo,
save/load, browser draft restoration and operation in the reference plant. Two repeated
12-pump placement/removal cycles restored the original GPU geometry count.
See [PROCEDURAL_PUMP.md](PROCEDURAL_PUMP.md) for the exact files, provenance and results.

## Vacuum vessels — first part of Phase B

The supplied ITER cutaway guides the layered construction and mechanical detail. It depicts
an entire facility: the vessel, magnets, blanket, cryostat, services and building. Those
remain individual components or optional assemblies in ForgeLab. The default world remains
an empty industrial hall.

This milestone upgrades both existing vessel variants:

- **Tokamak Vacuum Vessel:** hollow steel skins, nine representative sector joints with
  visible tangential flange bolts, circumferential reinforcing bands, closed inspection
  covers, upper service panels, lifting eyes and four mounting pads. The nominal size is
  still 17 m across and 4.6 m high, from major radius 6.2 m and tube radius 2.3 m.
- **Cylindrical Vacuum Chamber:** hollow casing, bolted removable end covers, stiffening
  rings, vertical ribs, closed mounting/access covers and a reinforced base skirt. Its
  default size remains 3 m in diameter and 3 m high.
- **Service interfaces:** collars, fasteners and open bores follow the existing socket
  positions and directions. Fluid diameters and vacuum flange bores come from sim-core's
  port definitions. Fuel/heating fittings have representative visual sizes because their
  engineering definitions do not publish a diameter; no new rating is implied.
- **Interiors:** the existing product regions now have purpose-built geometry. The torus
  exposes outer shell, shielding-water layer, inner shell, tiled armour and vacuum/plasma
  volume; the cylinder exposes wall, limiter rings and vacuum/plasma column. The existing
  `SCHEMATIC INTERNAL REPRESENTATION` label remains visible during inspection.
- **Resizing:** changing vessel dimensions regenerates the shell, details and socket fittings
  through the existing component definitions. Selection, transforms and saving use the same
  editor state as before.

The catalogue still defines a circular torus cross-section. This pass preserves that shape.
The reference's elongated ITER section and full plant construction are further visual and
engineering work. Shell-layer proportions, armour arrangement, joint counts and lifting
details are schematic. They are not manufacturing data or additional simulated structures.
Regions use the part's published state; there are no invented internal temperature/field maps.

Static geometry is batched into three surfaces per vessel: **51,974 triangles** for the torus
and **41,462** for the cylinder. Shared fastener prototypes and existing materials/disposal
paths are reused. There is no mesh per bolt and no new dependency.

### Files changed in this milestone

Paths beginning with `scene/` are under `apps/web/src/builder/`.

| File                           | Change                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `scene/vessels.ts`             | Both vessel assemblies and their schematic product-region geometry                                                |
| `scene/vesselGeometry.ts`      | Dimensioned hollow skins, analytic normals and service penetrations                                               |
| `scene/vessels.test.ts`        | Bounds, open bores, engineering-data preservation, resizing, interior visibility and geometry budgets             |
| `scene/industrialGeometry.ts`  | Expose the existing shared hex-head prototype for joint and mounting fasteners                                    |
| `scene/machines.ts`            | Connect the existing two vessel types to their detailed renderer                                                  |
| `scene/internalModels.ts`      | Dispatch vessel internals using optional authoritative socket data                                                |
| `scene/Internals.tsx`          | Pass socket data and name internal meshes for rendered inspection checks                                          |
| `scene/internalModels.test.ts` | Include the two new bespoke internal models in catalogue coverage                                                 |
| `e2e/vessels.mjs`              | Production-editor placement, picking, ports, dimensions, saves, interiors, resource release and activation checks |
| `docs/VISUAL_PROGRESS.md`      | Cumulative work, implementation scope, asset provenance and verification record                                   |

### Asset provenance

| Asset                                                                 | Source and rights                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Vessel shells, fittings, armour, joints, supports and lifting details | Repository-authored procedural TypeScript; follows repository code rights, with no imported model licence |
| Primitive geometry and rendering                                      | Existing Three.js dependency under its MIT licence                                                        |
| Surface maps and lighting used in verification                        | Existing locally generated ForgeLab materials and environment                                             |
| Optional photographic lighting/floor                                  | Existing Poly Haven CC0 catalogue recorded in [ASSETS.md](ASSETS.md); not required                        |
| Supplied ITER illustration                                            | Visual direction supplied by the user; its pixels and branding are not shipped as game assets             |

No paid model-generation service, exported GLB, external texture download or asset bucket
is required. This manifest does not assign a new licence to the project.

### Repeatable verification

```bash
pnpm verify
pnpm format:check
pnpm vercel-build
node scripts/serve-output.mjs 3000
```

In another shell:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  E2E_SHOTS=/tmp/forgelab-vessels node e2e/vessels.mjs http://localhost:3000
```

The browser check opens the real editor, places both machines from the parts drawer, picks
their visible surfaces, measures socket overlays and clicks the vacuum socket. It changes
dimensions and checks the rendered bounds, exercises transforms and undo, round-trips a save,
reloads a browser draft and inspects the labelled interior. It then repeats mixed-vessel
placement/removal, inspects the optional assembled plant and activates the existing reference
plant until simulation-driven ignition. Stopping must restore the exact build document.

The hollow skins and reinforcing bands trim individual triangles at service penetrations.
The aperture checks cast rays through the centre and eight surrounding points, so a band
cannot pass across a usable coolant/vacuum bore. Vessel regions use actual geometric depth
spacing during inspection; the generic band model's polygon offset is disabled for these
two detailed shapes to keep thin armour in front of the casing. Horizontal section views
open the torus tube and show its lining. Layer spacing remains schematic.

Use `taskset -c 0 pnpm verify` on this CPU-constrained cloud runner to keep test concurrency
within its quota. Benchmarks run without competing software-rendered browsers. Chromium here
uses SwiftShader: browser screenshots verify appearance and behavior, not hardware GPU frame
rate. Full cloud-save and multiplayer end-to-end suites need the configured Supabase/LiveKit
stack described in [COMMUNICATIONS.md](COMMUNICATIONS.md).

### Results for the vessel milestone

- `taskset -c 0 pnpm verify`: passed type checking, lint, all **618 tests in 70 files**
  and the production build. The final 384-part simulation benchmark measured 9.87 ms/tick
  against its 16 ms budget, without a software-rendering browser competing for CPU.
- `pnpm format:check` and `pnpm vercel-build`: passed. The existing large-bundle warning
  remains. The production build uses local-only mode because cloud credentials are absent.
- `e2e/vessels.mjs`: passed with Chromium/SwiftShader and no page or console errors. The
  test verified the 14 tokamak sockets and 12 cylindrical-chamber sockets, including clicking
  a real vacuum socket. Resizing, transforms, undo, file round trips, browser draft reload,
  labelled cutaways and section views passed.
- Two cycles of placing/removing six mixed vessels increased GPU geometry counts from
  **105 to 129 and back to 105** each time. All **30 tracked machine geometries** were
  disposed each cycle. The hall's wide-view geometry is warmed before measuring, so its
  first-time resource allocation is separate from machine cleanup.
- The optional assembled plant rendered with its layer and section controls. The reference
  plant reached simulation-driven ignition; stopping restored the exact pre-run design hash.
- Before/after exterior, socket, cutaway, horizontal-section, assembled-plant and operating
  screenshots were captured and visually inspected. The tiled armour is visible in section.

Evidence is outside the checkout at `/workspace/artifacts/forgelab-vessels/`:
`tokamak-vessel-before.png`, `tokamak-vessel-after.png`, `tokamak-vessel-section.png`,
`reactor-chamber-before.png`, `reactor-chamber-after.png`, `reactor-chamber-section.png`,
`assembled-cutaway.png`, `assembled-vessel-inspection.png`, `reference-plant-operating.png`,
`verification.log` and `browser-check.log`, plus the socket/camera-cutaway captures.

The full cloud acceptance and multiplayer end-to-end suites were not run: the local
Supabase/LiveKit stack is not configured. Existing SQL policy and collaboration unit tests
passed in `pnpm verify`. The full showroom suite was not rerun for this milestone; the
focused vessel suite checks the relevant inspection, activation and reset paths. Earlier
showroom-run limitations remain recorded in [FRONTEND_LIGHTING.md](FRONTEND_LIGHTING.md).
Hardware GPU frame rate and larger-facility rendering performance remain unmeasured.

## Remaining work

This is the first vessel milestone in Phase B. Magnetic coils, the generator, steam turbine
and steam generator still need their detailed visual passes. Routed construction assets,
library/placement polish, further interior work and hardware performance testing follow
in the requested development order. The existing simulation and realtime infrastructure
remain the foundation.
