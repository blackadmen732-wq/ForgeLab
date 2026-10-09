# Performance

## Budgets

| Path                                | Budget                  | Why                                      |
| ----------------------------------- | ----------------------- | ---------------------------------------- |
| One simulation tick (1/60 s)        | < 16 ms for 400 parts   | real time at 1× on one core, in a worker |
| A Build-mode edit (edit → re-solve) | < 100 ms for 400 parts  | feels immediate                          |
| Worker frame packing                | < 10 ms                 | frames go out at up to 20 Hz             |
| Leaderboard verification            | < 60 s (function limit) | capped at 400 parts / 1600 links         |

## Measurements

Node 22, one core of the development container, `pnpm test` (numbers are printed by
`packages/sim-runner/src/benchmark.test.ts`, which also enforces loose budgets):

| Scenario                                                    | Result                       |
| ----------------------------------------------------------- | ---------------------------- |
| Benchmark lattice (384 parts, 320 links): build             | 123 ms                       |
| …re-solve after a settings change                           | 24 ms                        |
| …per tick                                                   | **1.5 ms**                   |
| …snapshot / canonical design hash                           | 1.2 ms / 70 ms               |
| …worker frame build                                         | 2.3 ms                       |
| Reference plant (16 parts, full plant physics): per tick    | **0.37 ms** (≈45× real time) |
| Standard verification of the reference plant (36 000 ticks) | ≈ 5–6 s                      |

Builder store on the 384-part lattice (editor round trip: capture for undo, apply,
re-solve, snapshot):

| Action                      | Before spatial hash | After      |
| --------------------------- | ------------------- | ---------- |
| Add a part                  | 43 ms               | 33 ms      |
| Move a part (with snapping) | 26 ms               | 27 ms      |
| Undo                        | 99 ms               | 113 ms     |
| Duplicate all 385 parts     | **2 470 ms**        | **326 ms** |

## Where the time goes, and the O(N²) paths

Found and fixed:

- **Socket snapping and automatic connection** compared every moved socket with every
  socket in the scene (O(N·M·S²)). Duplicating the lattice took 2.5 s. Both now use a
  uniform-grid spatial hash (`apps/web/src/builder/store/socketIndex.ts`): each query
  inspects 27 cells.

Still quadratic, documented and acceptable at V0.1 scale:

- **`SimulationWorld.#refreshComponentConnections`** rebuilds every component's
  connection list after each `connect`/`disconnect`: O(N + L) per call, so O(L·(N + L))
  when an edit makes many links (duplicating 385 parts with 320 links ≈ 0.4 M operations).
  Fix when needed: update only the two endpoints.
- **`SimulationWorld.findConnectionCandidates`** (engine API, still used by tests and
  headless tools) is all-pairs. The builder no longer calls it.
- **Plant topology** tests every coil and blanket against every vessel
  (O(coils × vessels)); plants have a handful of each.
- **Undo history** stores a full serialised design per step (≤ 100 steps). At 400 parts
  that is ~1 MB per step in the worst case; structural sharing or diffs would cut it.
- **Canonical design hashing** is pure-JS SHA-256 over canonical JSON (70 ms at 384
  parts). It runs on save and on verification, not per edit.

## Rendering

Each part is one React component with its own material (so overlays can colour parts
independently) and shared-per-part geometry. The canvas uses `frameloop="demand"`:
nothing renders while nothing changes. During simulation the scene is updated
imperatively from worker frames; React re-renders only the panels, throttled by the
frame rate (≤ 20 Hz). Service connections are one `LineSegments` draw call; sockets are
one `InstancedMesh`. The 384-part lattice renders in a few hundred draw calls; instancing
identical parts is the next step if very large designs become common.

GPU numbers were not measured in the development container (software rendering only);
they should be taken on real hardware before claiming frame rates.
