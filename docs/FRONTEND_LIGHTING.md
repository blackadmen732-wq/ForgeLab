# Industrial lighting and surface pass

This pass builds on `d9d6e1d37fa1de30c79bb33f4da9cd5088ba51e5` from
`ccr-3bd0d75a-5yspev`. It changes presentation only.

## Appearance

- The main hall balances a warm key with cool fill and stronger environment reflections.
  Broad procedural roof-light reflections help curved and flat machine surfaces read.
- Machine casings use lighter handling wear and finer normal detail. Material-library
  colours, metalness, and roughness remain the source of their base appearance.
- HIGH/ULTRA floor reflections are subdued; contact occlusion and vignette are lighter.
  LOW/MEDIUM keep their existing rendering features and texture-size budgets.
- Reflective and standard floors have distinct React keys. Crossing quality tiers must
  not reset the attached reflector to a plain white default material. The browser check
  verifies both the material class and the albedo map after each tier change.
- Vignette edges blend toward black with a smaller offset. The shader's `darkness`
  uniform is not an opacity: values below one add grey to a dark scene.
- Composer colour targets retain multisampling (up to four samples, capped by renderer
  support), so enabling post-processing does not discard the canvas's edge smoothing.
- The dark facility remains an after-hours setting with its existing startup, blackout,
  emergency lighting, reduced-effects behaviour, and procedural asset fallbacks.

## Shadows

`scene/environment/PlantShadows.tsx` fits the key light's shadow projection to the rendered
component envelopes and the visible hall floor. Including floor receivers prevents crane
shadows from ending abruptly in a wide view. Including each envelope's projected floor
shadow prevents tall machines' shadows from being clipped.

The projection follows live, dragged, and exploded transforms. It snaps its centre to
whole texels, quantises its span, and scales normal bias with texel size. Shadow resolution
still follows the existing graphics tier. This does not add a light or another shadow
render pass. Bounds are updated on edits, simulation frames, camera/projection changes,
and explicit shadow invalidation; stationary views continue to use on-demand rendering.

No drawing bounds, light parameters, surface maps, or quality settings enter the design
document or simulation.

## Repeatable checks

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test --maxWorkers=2 --exclude '**/benchmark.test.ts'
pnpm test packages/sim-runner/src/benchmark.test.ts --maxWorkers=1
pnpm vercel-build
node scripts/serve-output.mjs 3000
```

In another shell:

```bash
E2E_SHOTS=/tmp/forgelab-lighting node e2e/lighting.mjs http://localhost:3000
node e2e/showroom.mjs http://localhost:3000
```

`lighting.mjs` accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when an installed Chromium
is used instead of Playwright's browser download. It checks an empty hall, a small pump,
off-site placement and undo, all four quality tiers, environment switching, and exploded
inspection. Quality and inspection changes must preserve the design hash. Optional
screenshots cover empty, medium/high, night, and exploded views.

It also checks that a stationary view stops drawing and that the pipe-rupture scenario
passes preflight, presents a coolant failure, and restores the original design on return
to Build. Projection checks wait for the rendered update rather than assuming a fixed
delay is sufficient on software GL.

The six shadow unit tests cover projection containment, floor receivers, distant designs,
and stable texel alignment. Do not run CPU timing benchmarks alongside several software
rendering browsers: the baseline benchmark exceeded its 16 ms budget under contention,
then passed alone at 8.5 ms/tick without changing any assertion or simulation code.

Browser captures in the cloud use software rendering. They establish appearance and
behaviour on that renderer, not a hardware GPU frame-rate claim. The full acceptance and
collaboration suites additionally require local Supabase and LiveKit as described in
`DEPLOYMENT.md` and `COMMUNICATIONS.md`.

The broader showroom run passed startup to fusion and quench, electrical, boiling,
structural, and cascade scenes. It also encountered a preflight-click timeout and a
plasma-dust visibility assertion during the software-rendered run; that full suite is
not a clean pass. The focused test rechecks the preflight/coolant path. Full cloud
acceptance and collaboration were not run: the available local Supabase tooling could
not start this repository's configured stack. No backend configuration was changed.

The isolated plasma-disruption check subsequently detected the expected dust effect on
both the unchanged baseline and the changed production build. This narrows the broader
run's failure to an intermittent suite/timing issue; it does not turn that full run into
a pass.
