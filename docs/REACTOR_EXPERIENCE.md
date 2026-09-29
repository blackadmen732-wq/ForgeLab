# ForgeLab Interactive Reactor Experience — plan

**Goal:** a new player can enter the reactor hall → place finished machines → connect them
→ activate the plant → see and hear plasma operation → experience an explainable failure
→ inspect the cause → change the design → run it again.

## Starting point (inspected)

| Area                 | Already there                                                                                                                                                                                                                                                                          | Missing for the slice                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sim-core`           | structural statics; plant solver (`plant/solver.ts`): DC electrical islands, lumped thermal, coolant loops with pump head vs. pressure drop, vacuum pump-down, magnets with quench and hoop stress, 0D tokamak plasma (IPB98), Bosch–Hale D-T; causal failure chains; model confidence | a staged commissioning sequence; typed port ratings and compatibility; a cryogenic network (cryo capacity is internal to each coil today)               |
| `reactor-components` | 21 parametric parts (one material each), reference plant, interactive starter                                                                                                                                                                                                          | product data: internals and material regions, ratings, failure modes, audio/visual profiles; cryoplant, magnet power supply, valve, protection computer |
| `materials`          | 5 sourced materials, room-temperature scalars                                                                                                                                                                                                                                          | optional property groups (superconducting, cryogenic, nuclear) and the materials the internals need                                                     |
| `apps/web` builder   | R3F viewport on an infinite grid; drawer, inspector and timeline always open; overlays (material, stress, temperature, power, coolant, magnetic, plasma); cutaway; timeline with failures and "Why?"                                                                                   | the hall; a clean fullscreen shell; ACTIVATE; audio; port-to-port connection; internals view; rewind to cause; run report and personal best             |
| collaboration        | channels, voice, chat, presence, roles, shared saves                                                                                                                                                                                                                                   | untouched this milestone                                                                                                                                |

## Rules kept

- `sim-core` is the only authority on physical truth. Environment, audio, overlays and
  camera read state; nothing they do reaches the simulation or the save file.
- Materials describe substances; product definitions (in `reactor-components`) describe
  machines made of them; sim-core roles describe physics.
- Magnetic fields, neutrons, gravity and radiation stay spatial interactions — never ports.
- The architecture tests (`sim-core/src/architecture.test.ts`,
  `protocol/src/boundaries.test.ts`) stay green; every commit keeps `pnpm verify`,
  the acceptance test and the collaboration test passing.

## Work, in order

1. **Hall** — `apps/web/src/builder/scene/environment/`: preset registry (Industrial Hall
   built; Clean Lab, Dark Facility, Outdoor Test Site, Empty Grid prepared), stored as a
   per-user preference.
2. **Shell** — drawer and inspector contextual and collapsed by default; telemetry behind
   an Engineering Overlay toggle; simulation fills the viewport with a compact HUD.
3. **Finished components** — typed port specs with domain ratings in
   `sim-core/connections.ts` (+ `portsCompatible`); product definitions with internals,
   ratings, failure modes and profiles in `reactor-components`; material property groups.
4. **Slice catalogue** — cryoplant with a cryogenic network the solver uses, magnet power
   supply, valve, protection computer; finished procedural models; a compact plant
   blueprint.
5. **Connections** — click port → compatible ports highlight → click target → routed
   cable or pipe.
6. **ACTIVATE** — commissioning stages in sim-core (electrical → cooling → cryogenics →
   vacuum → magnet ramp → fuel/heating → ignition → burn), each advanced by physical
   conditions, published in snapshots; the UI and scene react to them.
7. **Audio** — Web Audio, synthesized; consumes snapshots and failure events only.
8. **Visualization modes** — Normal, Cutaway, Temperature, Coolant, Power, Magnetic,
   Stress, Plasma (Neutron prepared); internals cutaway per component.
9. **Diagnose → fix** — rewind to the root-cause tick (deterministic re-run), highlight
   the initiating component, measured vs. limit, consequence chain, return to Build with
   it selected; run report with margins and personal best.
10. **Verify** — a browser test of the full loop; docs.
