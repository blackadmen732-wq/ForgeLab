# Modular coolant pump — first construction milestone

The shared construction system now also supports [generator and turbine modules](POWERTRAIN_CONSTRUCTION.md).
This document records the original pump milestone.

This adds a playable stock pump kit to the existing editor. The finished `coolant-pump`
remains available and old projects retain their original component, ports and behaviour.
The user-provided facility and machinery illustrations are design references, not shipped
assets or screenshots of completed facility features.

## Playing the slice

1. Open `/app`, start a blank project and open the parts drawer.
2. Choose **Kits → Coolant Pump Kit** for four loose modules, or choose individual pump
   modules under **Parts**. Clicking a module starts translucent placement; click in the
   viewport to place, hold Alt to bypass snapping, or Escape to cancel.
3. Move the casing onto the skid's mount, the drive onto the casing, and the motor onto
   the drive. The stock mounts align position and rotation. A nearby target stays stable
   during small pointer adjustments. Use the move gizmo's vertical axis to reach elevated
   mounts; a placement preview can also follow existing equipment surfaces.
4. The contextual inspector distinguishes present modules, missing/separated joints,
   unsupported substitutions and complete construction. Group a completed pump to move
   and rotate it together. Alt-click selects a module within a group; **Detach module**
   removes its mount joints and pulls it aside. Undo restores that edit.
5. Connect fluid at the casing and power/control at the motor using the existing Connect
   tool. Select the assembly and save it under **My Assemblies** to place independent
   copies. Activate runs the existing preflight and worker simulation; stopping restores
   the exact authored build.

Ordinary **Take apart** continues to ungroup a selection without breaking its physical
connections. **Detach module** is the distinct action that disconnects construction joints.
The slice does not place support machines or create service connections for the player.

## Architecture and durable state

- `sim-core/construction.ts` defines the supported stock capability and determines
  completion from module types, dimensions, material, seated transforms and three actual
  compatible mount joints. Visual groups are not completion criteria.
- `reactor-components/assemblyRecipes.ts` exposes that capability through the existing
  catalogue; `builtin.ts` defines four real module entries and `kits.ts` provides the loose
  kit. No parallel component catalogue or physics engine is introduced.
- Optional `AssemblyFileV2.buildAssemblies` stores recipe identity and part membership.
  The parser validates references and unique ids; derived completion and claimed result
  types are never trusted from a file. Serialization, selection extraction, insertion,
  duplication, patterns and undo remap/preserve membership. Deleting parts prunes references.
- A complete stock assembly is condensed **inside sim-core** into one existing
  `coolant-pump` plant model. External connections are mapped for that solve; the authored
  inlet/outlet remain on the casing, power/control on the motor, and support on the skid.
  The structural simulation retains the four real parts and counts each mass once.
- The stock hydraulic/electrical model is unchanged: 4,000 kg/s rated flow, 120 m rated
  head and the existing efficiency/default operating parameters. This is not a motor or
  impeller design solver. Unsupported materials, shapes, bore/fluid variants or extra
  construction modules remain inactive and are reported explicitly.
- The assembly uses the existing lumped temperature model, with summed module mass and
  heat capacity for the stock stainless modules. Published heat rates are distributed by
  module mass; electrical readings belong to the motor and coolant readings to the casing.
  There is no independent internal temperature field or shaft-speed solver. Coupling
  animation follows the casing's actual flow as a presentation activity, not measured RPM.
- Preflight uses the same resolution and warns about incomplete/unsupported construction.
  `designHash` includes construction metadata because it affects physical behaviour;
  legacy designs without that field keep the old hash input. Cloud saves and collaboration
  continue to use the existing version/document infrastructure.

## Visuals and source records

The four renderers split the existing `coolantPump.ts` builder through
`coolantPumpParts.ts`; the finished pump and modules use the same geometry definitions.
Mount details are schematic. Repeated fasteners remain merged geometry, rather than one
mesh per bolt. The assembled envelope remains 2 × 2 × 2 m and the static geometry stays
under the existing 30,000-triangle ceiling. The separately rendered coupling is animated
from published state. Placement previews use the same module geometry.

All new geometry is repository-authored TypeScript. Rendering uses the existing Three.js
MIT dependency and existing procedural ForgeLab surfaces/lighting. No new library, paid
model service, GLB, texture or HDRI download is required. Existing optional CC0 assets keep
their records in [ASSETS.md](ASSETS.md). The supplied illustrations and branding are not
copied into the product. This note does not assign a new licence to repository code.

## Verification

```bash
pnpm verify
pnpm format:check
pnpm vercel-build
node scripts/serve-output.mjs 3000
```

In a second shell:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  E2E_SHOTS=/tmp/forgelab-pump-kit node e2e/pump-kit.mjs http://localhost:3000
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node e2e/pump.mjs http://localhost:3000
```

Focused checks cover real drawer/ghost placement, snap bypass, incomplete activation,
completion, group rotation and Alt-picking, detach/undo, authoritative port coordinates,
project and browser-draft reload, saved-assembly copies, repeated resource disposal,
legacy simulation, a modular pump operating inside the existing reference plant, coupling
animation and exact return to build. Unit tests also protect corrupted/forged membership,
unsupported substitutions, mass accounting, deterministic physics and design hashes.

Browser testing here uses software Chromium rendering. This does not establish hardware
GPU frame rates. Account/cloud/voice end-to-end checks require the Supabase/LiveKit
configuration documented in [COMMUNICATIONS.md](COMMUNICATIONS.md); local-only checks do
not establish that those hosted services are configured or deployed.

## Scope still ahead

Service cables/pipes retain the existing two-click connection method. A continuous
service drag gesture, general support/clearance previews, interchangeable motor performance,
full structural stacking validation, an enlarged multilevel campus, machine-family LOD and
live multiplayer stress testing remain separate milestones. No generic pathfinding or
facility rebuild was included in this pump slice.

## Results from this milestone

- `pnpm verify`: **640 tests across 71 files passed**, plus typecheck, lint and build.
- `pnpm format:check` and `pnpm vercel-build`: passed. The existing large-bundle warning
  remains; this build uses local mode because Supabase browser configuration is absent.
- `e2e/pump-kit.mjs` and `e2e/pump.mjs`: passed against the production build, with no
  browser console/page errors. Both stop paths restored the exact pre-run design hash.
- Two modular resource cycles each added four complete pumps (16 modules): GPU geometry
  count **129 → 181 → 129**, with all **52 tracked geometry resources** disposed per cycle.
  The legacy pump check also returned **111 → 171 → 111** in both cycles.
- A separate single-CPU check of **100 stock pumps / 400 modules** measured **2.22 ms per
  simulation tick**, **32.6 ms median** build edit and **71.1 ms maximum** over eight edits.
  These are environment measurements, not a hardware-GPU frame-rate guarantee.
- Browser inspection found stale world matrices after rapid edits/undo. Component meshes
  now synchronize world matrices and invalidate the demand-rendered scene when updated;
  actual Alt-picking after undo/redo and group rotation passes.
- Live account, cloud-save and voice/collaboration browser suites were not run: they need
  configured Supabase/LiveKit services. Existing database-policy, API and collaboration
  unit/integration checks included in `pnpm verify` passed.

Screenshots captured from the actual editor include loose modules, snapped translucent
placement, assembled pump, detached motor, port overlays and a modular pump operating in
an otherwise existing reference plant. The reference-plant test fixture explicitly replaces
its legacy pump with construction parts; it does not automatically assemble a player's plant.

## Changed files

| Area                              | Files                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core capability and world         | `packages/sim-core/src/construction.ts`, `world.ts`, `index.ts`, `plant/preflight.ts`                                                                                                 |
| Durable save contract             | `packages/sim-core/src/serialization/schema.ts`, `serialize.ts`                                                                                                                       |
| Existing component catalogue      | `packages/reactor-components/src/assemblyRecipes.ts`, `builtin.ts`, `kits.ts`, `index.ts`, `pump-kit.test.ts`                                                                         |
| Verification identity             | `packages/sim-runner/src/verification.ts`, `runner.test.ts`                                                                                                                           |
| Editor actions/history            | `apps/web/src/builder/store/editor.ts`, `assemblies.test.ts`, `apps/web/src/builder/commands.ts`                                                                                      |
| Library and inspector             | `apps/web/src/builder/ui/ComponentDrawer.tsx`, `Inspector.tsx`, `PreflightDialog.tsx`, `apps/web/src/builder/builder.css`                                                             |
| Scene and shared pump builder     | `apps/web/src/builder/scene/coolantPump.ts`, `coolantPumpParts.ts`, `coolantPump.test.ts`, `machines.ts`, `meshes.tsx`, `PlacementGhost.tsx`, `Viewport.tsx`, `ComponentAnimator.tsx` |
| Activity presentation             | `apps/web/src/presentation/visualState.ts`                                                                                                                                            |
| Browser verification              | `e2e/pump-kit.mjs`, `e2e/pump.mjs`                                                                                                                                                    |
| Rules and milestone documentation | `CLAUDE.md`, `docs/MODULAR_PUMP.md`                                                                                                                                                   |
