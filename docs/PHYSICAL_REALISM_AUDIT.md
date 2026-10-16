# Physical realism audit — 16 October 2026

Inspected the developed modular-pump branch at `c98a901`, then its work-order extension.
This is a construction audit, not a claim of CAD precision or validated reactor physics.
The supplied realism request is broad; fixes are staged without replacing the engine.

| Priority / type                            | Existing behavior and responsible code                                                                                                                                                                                                                                                       | Plausible behavior / proposed stage                                                                                                                                                     | Verification                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 geometric: service clipping             | `apps/web/src/builder/scene/routing.ts::routePath` uses fixed tray heights and one x/z corner. No obstacle queries. `Cables.tsx` rounds and draws it, including crossings of machinery/other routes.                                                                                         | Shared deterministic route planner, swept tube clearance against component proxies and existing services; alternate routes; explicit blocked state if search fails.                     | Floor cable/pipe crossing at same vs different heights; machine obstruction; endpoint escape; bounded search; actual browser route output. **First fix.** |
| P0 construction: placement interference    | `store/editor.ts::{previewPlacement,commitPlacement}`, transforms and `setDimension` have no solid intersection validation. A green snap confirms a keyed mate, not whole-assembly clearance.                                                                                                | Reusable broad phase and narrow phase for all edits, compound occupied shapes for detailed machinery, legitimate mating contacts, red invalid previews and one transactional rejection. | Move/rotate/resize/groups, valid contact and supports, intentionally nested hollow vessels. Pending. Do not hard-block all machinery using just an AABB.  |
| P1 visual/physical consistency: route data | `sim-core/src/connections.ts::Connection` stores endpoints/type/load capacity, not service path, diameter, wall, insulation or installation supports. Renderer reconstructs the path. Moving endpoints redraws it but cannot calculate changed cable resistance/pipe loss from route length. | First expose derived geometry validity consistently. Later add versioned authored routes/ratings and supported physical models; preserve old saves.                                     | Move/reload/disconnect consistency now; route-loss physics and migrations in a later milestone. Never make the renderer invent a physical consequence.    |
| P1 geometric: shape/radius limits          | `routeStyle` clamps large bores; `filleted` shortens a bend to fit legs, without enforcing a manufacturer's bend radius.                                                                                                                                                                     | Preserve bore-derived outer envelope; construction bend policy explicitly marked approximate; later real fittings, wall and material-specific bend data.                                | Large-bore/floor tests, rounded-path clearance, short elbows, physical length.                                                                            |
| P1 construction: environment               | Industrial hall geometry in `scene/environment/hall/MainReactorHall.tsx` is presentation. Walls, doors, catwalks and crane are not equivalent authored sim-core solids/supports.                                                                                                             | Feed authored facility collision/support proxies into the common construction system; distinguish scenery from load-bearing objects.                                                    | Routes through walls, walkway/access obstruction, stairs meeting platforms. Pending; do not claim hall collision coverage.                                |
| P1 support/access                          | Core `systems/structural.ts` already solves support/load paths; dynamics' optional Rapier uses box colliders, and the default backend has no inter-component collision. Editor does not enforce all installation/maintenance envelopes.                                                      | Reuse actual support results for warnings, add declared service envelopes; keep bad engineering possible. Do not delegate authority to Rapier.                                          | Existing mass/structural/failure suites; unsupported equipment and maintenance warnings. New placement integration pending.                               |
| P1 collaboration                           | Shared cloud saves reject stale parent versions; soft locks are advisory. There is no operation-by-operation shared geometric transaction. Work orders do not change that.                                                                                                                   | Revalidate geometry on accepted shared revisions; future atomic edit protocol must check revisions plus geometry.                                                                       | Existing save conflicts/permissions; simultaneous geometry transactions pending. No new transport.                                                        |
| P2 operating machinery                     | Pump coupling uses actual flow as visual activity, not a measured RPM; interiors remain labelled schematic. Not every moving part has an operating envelope.                                                                                                                                 | Declare supported movement/maintenance envelopes and show limitations; no new failures driven by rendered overlap.                                                                      | Existing pump browser/geometry tests; machine-specific operating envelopes pending.                                                                       |

Existing core port compatibility remains the sole interface authority. Deleting a connection
already removes it from the world and solver topology. Activation simulates a copy and stop
restores the design. Material sources and reduced-model confidence are preserved. Those
systems need regression coverage, not parallel replacements.

## Acceptance scope

The first route milestone targets actual three-dimensional tube clearance, obstacle-aware
route proposals and visible validation after editing. It cannot certify every detailed mesh,
provide cable trays/clamps, minimum bend radii from missing manufacturer data, pipe weight
or thermal expansion, or synchronize arbitrary live edits. Those remain explicit audit items.
Clearance margins are construction policy, not physical material constants. No fabricated
thermal/flow/structural outcomes should be added to make screenshots look realistic.

## First implemented stage: service clearance

`sim-core/src/serviceGeometry.ts` now owns the former renderer routing geometry.
`serviceRouting.ts` supplies one deterministic installation planner consumed by the editor,
renderer and preflight. Existing port compatibility remains unchanged.

- Broad-phase segment/AABB rejection limits narrow-phase work. Narrow phase uses distances
  to rotated core boxes, cylinders, toruses and arc proxies, including declared hollow
  space. Distance-based steps avoid skipping thin walls; unresolved grazing is conservative.
- Services occupy swept tubes with their full drawn radius. Finite-segment distances check
  cable/pipe crossings in 3D. Nonlocal self-intersections, rounded corners and the complete
  tube's floor clearance are checked, including a nonzero world ground level.
- An approximate 40 mm installation margin is a construction policy, not a safety-code or
  material value. Pipe outer-envelope estimates use the declared bore plus the existing
  30 mm allowance; large bores are no longer silently clamped smaller. Electrical/control
  radii remain schematic defaults until real cable products/insulation data are authored.
- A bounded search tries orthogonal lanes/heights around obstructions. A port's own machine
  is exempt only along the terminal segment through that engineered interface. Other legs
  still check that machine. The planner does not invent penetrations through unrelated walls.
- New service creation validates the new link and any formerly clear routes before committing.
  Failure restores the entire edit and history and leaves the source selected for a retry.
- Design edits revalidate all derived routes. Hidden objects still occupy space. Clear routes
  render the checked centreline. Unresolved links render a red dashed diagnostic guide rather
  than a solid pipe, with a contextual warning and an Inspect action. Their preflight warning
  explicitly explains that the existing network model still assumes the endpoint link.
- Existing loaded designs retain their links and can ACTIVATE ANYWAY under the existing sandbox
  rule. The renderer never breaks a network or invents a failure based on geometry.
- Route order is stable by connection id and survives save/load. No save-schema, physical
  model version, material property, connection domain or simulation equation changed. Routes
  are derived construction data; this is not yet authored length-dependent network physics.

### Evidence

`e2e/service-clearance.mjs --before` captured the previous production renderer sending a cable
through a solid 3 m equipment block. The new production browser test checks an actual detour,
then moves the block onto a terminal and verifies the warning and actual dashed Three.js
guide. It checks hidden obstacles, undo, save/load, transactional rejection of a new impossible
link and no page errors. Screenshots: `service-before-clipping.png`,
`service-after-clear-route.png`, `service-blocked-guide.png` in the exported artifact folder.

The 13 core tests cover pipe/cable occupied volume at equal vs separated heights, floor,
obstruction avoidance, terminal blockers, own-machine reentry, rounded-corner interference,
hollow cylinders, torus holes, rotation, thin-wall crossing, large bores, self-intersection
and finite waypoints for terminals outside their proxy. Three editor tests cover transactional
failure/history, incompatible ports, edit revalidation/preflight, hidden solids, undo,
disconnect, actual transformed endpoints, stable reload and no mutation of engine state.

### Still unresolved

This stage does **not** enforce every solid placement/drag/rotation/resize transaction.
Moving a solid onto a service reports the route conflict; a common compound-shape placement
validator and red placement preview are the next P0 stage. Core primitives approximate
detailed machine meshes; arc ends use a conservative rounded proxy. A successful route check
is not CAD clearance certification. Search failure means no route was found by this planner,
not that no possible route exists.

Facility scenery beyond the world ground is not included as authored collision geometry.
Real trays, clamps, sag, pipe supports/weight, maintenance envelopes, safety separation,
manufacturer bend radii and length-dependent losses remain pending. Shared-port branches
can report unresolved until a suitable distribution interface exists. Routes use build
snapshots; following falling run-state bodies and representing broken/invalid services in
the physical network require a separate authoritative connection-model milestone. Realtime
simultaneous geometry transactions remain pending; version-conflict protection is preserved.

The full Supabase/LiveKit suites cannot run in this environment because their local container
registry returned Forbidden. The new local work-order database/UI test is explicitly a
test-transport fixture, not evidence of real hosted multiplayer. No public deployment or
hosted database migration is claimed.

## Final verification for this stage

- `pnpm verify`: type checking, lint, **680 tests in 77 files**, and the production build passed after corridor pruning.
- `pnpm format:check` and `git diff --check` passed.
- `pnpm vercel-build` passed. The build remains in local-only mode because Supabase is not configured.
- Production Chromium: `e2e/service-clearance.mjs` passed against the final optimized planner.
- Production Chromium: `e2e/pump.mjs` and `e2e/pump-kit.mjs` passed on the integrated routing build: selection, ports, transforms, undo/redo, save/load/draft, repeated placement with resource disposal, actual plant-driven pump/coupling activity and exact reset. The later corridor-pruning change preserved routing output in the focused core/editor tests and the final production route check.
- The existing 384-part lattice benchmark passed at **8.31 ms/tick** in the final suite. No simulation equations or time steps were changed.
- The work-order milestone previously passed 664 tests plus the three-browser production-controls/local-Postgres test. Real Supabase/LiveKit end-to-end verification remains unrun, as explained above. The CI end-to-end job now includes both new browser checks; a remote CI result is not claimed here.

### Scale follow-up (P1)

A separate CPU fixture with **400 components and 20 services** found all 20 routes clear.
The optimized route-planning median was about **10 ms**. Whole-editor label edits measured
roughly **143–327 ms** across runs on the shared cloud CPU, exceeding the 100 ms edit target.
The whole-edit path includes snapshot/history, solve, persistence/hash work and route planning;
this measurement does not isolate their individual costs. Full-edit profiling and caching
remain a P1 follow-up before claiming the large-world performance goal. These are Node CPU
measurements, not hardware-GPU frame-rate evidence. The fixture script and JSON results are
included with the exported evidence.

### Files changed in this stage

- `.github/workflows/ci.yml`
- `apps/web/src/builder/BuilderRoute.tsx`
- `apps/web/src/builder/builder.css`
- `apps/web/src/builder/scene/Cables.tsx`
- `apps/web/src/builder/scene/routing.test.ts`
- `apps/web/src/builder/scene/routing.ts`
- `apps/web/src/builder/store/editor.ts`
- `apps/web/src/builder/store/serviceRouting.test.ts`
- `apps/web/src/builder/ui/PreflightDialog.tsx`
- `apps/web/src/builder/ui/RouteWarnings.tsx`
- `docs/PHYSICAL_REALISM_AUDIT.md`
- `e2e/service-clearance.mjs`
- `packages/sim-core/src/index.ts`
- `packages/sim-core/src/plant/preflight.ts`
- `packages/sim-core/src/serviceGeometry.ts`
- `packages/sim-core/src/serviceRouting.test.ts`
- `packages/sim-core/src/serviceRouting.ts`
