# CLAUDE.md — ForgeLab Engineering Rules

**Build anything. Physics decides.**

ForgeLab is a browser-based 3D engineering sandbox where players construct fusion plants —
and eventually more general machines — from real engineering components and materials. The
player decides what to build. ForgeLab determines what the resulting physical system does.

ForgeLab is NOT research-grade engineering software and must never present reduced models
as validated real-world reactor design.

This file is **architecture law, not a milestone**. Do not try to implement every sentence
in one session. Every milestone must obey it.

---

## 0. Working in this repository

- pnpm monorepo. Packages: `materials` (sourced data), `sim-core` (deterministic physics,
  the authority), `sim-runner` (worker/session protocol), `reactor-components` (catalogue,
  products, designs, scenarios), `protocol`, `multiplayer`, `voice`, `shared`. App:
  `apps/web` (Vite, React 19, React Three Fiber, `frameloop="demand"`). Serverless API in
  `api-src`, Supabase migrations and RLS tests in `supabase/`.
- Gates before every push: `pnpm verify` (typecheck, lint, tests, build) and
  `pnpm format:check`. After integration points also run the end-to-end suites against a
  production build (`pnpm vercel-build && node scripts/serve-output.mjs 3000`):
  `node e2e/acceptance.mjs`, `node e2e/collaboration.mjs`, `node e2e/showroom.mjs`
  (local Supabase + LiveKit: see docs/COMMUNICATIONS.md, "Local end-to-end").
- The React-compiler lint rules forbid mutating hook/memo values and reading refs during
  render: keep mutable scene state in module-level registries or classes.
- Simulation packages must not reference browser globals (`window`, `document`…); an
  architecture test enforces it.
- Never commit credentials. Never expose the Supabase secret key to the browser. Never trust
  browser-submitted scores or client-provided user ids: the server recomputes and verifies.
  Do not record microphones by default. Do not rebuild the collaboration stack.
- Do not add libraries that are not already installed without a clear reason.
- Keep every commit small, coherent and green.

**Connection domains in code.** `sim-core/src/connections.ts` has eleven connection types;
they map onto the seven domains below: structural ← `structural`, `mount`; electrical ←
`electrical`; fluid ← `coolant`, `steam`, `cryo`; vacuum ← `vacuum`; fuel ← `fuel`;
control ← `control`; mechanical ← `shaft`. `port` (a heating access port on a vessel) is a
vessel interface carrying beam/RF power, not a field or radiation link.

---

## 1. The product law

Everything built for ForgeLab should reinforce this loop:

IDEA → BUILD → CONNECT → CHECK → ACTIVATE → WATCH → SUCCEED / FAIL → UNDERSTAND WHY →
CHANGE SOMETHING → RUN AGAIN → SHARE

If a feature does not meaningfully improve this loop, question whether it belongs in the
current milestone.

## 2. Complexity goes downward, not outward

A beginner should be able to place a finished machine, connect it, press ACTIVATE and
understand the result without learning every internal property. The same machine exposes
progressively deeper information:

1. **Quick** — the machine and its ports (pump: coolant in, coolant out, power, control).
2. **Engineering** — flow, pressure, power, temperature, efficiency, operating margin.
3. **Internals** — motor, impeller, shaft, bearings, casing, seals, coolant cavity, their
   materials.
4. **Material / physics** — properties, temperature curves, resistance, stresses, failure
   limits, sources, model confidence.

There is one simulation. Never create separate "fake simple physics" and "real advanced
physics"; the UI progressively reveals the same model's depth. A beginner uses a pump in
five minutes; an expert can spend five hours understanding the same pump.

## 3. sim-core is physical truth

`@forgelab/sim-core` is the authority on physical state. Renderer, UI, VFX, audio, camera
and replay consume simulation state; they never decide physical truth.

PHYSICAL INPUT → SIM-CORE → SIMULATION STATE / FAILURE EVENT → UI / VISUAL / AUDIO / REPLAY

Never: "the VFX looked like an explosion, therefore mark the component failed."
Presentation may estimate visual intensity from published state. It cannot invent
failures, and presentation collisions never create simulation outcomes.

## 4. Seven connection domains

Do not casually add more.

| Domain             | Colour  | Shape / icon   |
| ------------------ | ------- | -------------- |
| Structural         | gray    | hex / bolt     |
| Electrical         | yellow  | lightning      |
| Fluid / coolant    | blue    | droplet        |
| Vacuum             | purple  | hollow circle  |
| Fuel               | magenta | fuel / diamond |
| Control / data     | teal    | node / signal  |
| Mechanical / shaft | orange  | gear           |

Never rely on colour alone: every domain also has a shape, an icon and a text label.

## 5. No fake connections (protected)

Gravity, magnetic fields, neutron transport, ionizing radiation, radiative heat transfer and
collisions are spatial interactions, not ports. A magnetic field is not a "magnetic
connection"; a neutron does not travel through a "neutron cable". Only engineered
interfaces get ports.

## 6. Port definitions must be physically meaningful

A port is a domain plus domain-specific engineering properties: fluid (medium, direction,
bore, pressure and temperature rating, connector family); electrical (direction, voltage,
current/power rating, AC/DC); vacuum (flange diameter, family, pressure range); mechanical
(shaft diameter, torque, RPM rating, axis). Use capability-specific schemas; do not add
irrelevant properties to every port.

## 7. Port compatibility belongs in sim-core

The UI never independently decides whether two engineering ports are compatible. It asks
the authoritative deterministic compatibility system (`checkPortCompatibility`), which
returns COMPATIBLE, WARNING or INCOMPATIBLE with machine-readable reasons, e.g.
`{ state: "warning", reasons: [{ code: "BORE_MISMATCH", source: 0.4, target: 0.3 }] }`.
The UI only presents the result.

## 8. Compatibility is deterministic and tested

No scattered UI `if` statements. Tests cover the major combinations: water out → water in
(compatible); water → helium (incompatible while mixed media are unsupported); fluid →
electrical (incompatible); matching voltages (compatible); voltage mismatch (per the
electrical model); 400 mm → 300 mm (warning when a transition is supported); pressure or
temperature rating below expected conditions (warning). Warnings follow documented rules.

## 9. No physics hidden in magic adapters

If a 400 mm → 300 mm transition is supported, represent the reducer in the connection model
(local pressure loss, geometry, rating, mass, material). Do not magically convert voltage —
use a transformer or converter. Do not convert water into helium. Do not convert torque or
speed without a gearbox. Convenience is good; invisible physical cheating is not.

## 10. Three connection UI states

Compatible: green halo + check. Warning: amber halo + warning icon. Incompatible: dimmed /
red + X. The port keeps its domain colour underneath, so green never reads as a domain.

## 11. Connecting takes two actions

Click the source port (compatible ports highlight), click the destination; the route is
generated and the connection created. No confirmation dialog for a normal valid
connection. Undo exists.

## 12. Allow bad engineering

Do not block a design because it is bad engineering if the simulator can evaluate it.
Undersized conductors, low ratings, small pipes, weak supports, insufficient cooling or
power are warnings; physics produces the consequences. Hard-block only what is
semantically impossible or unsupported: an electrical terminal to a coolant port,
unsupported fluid mixing, interfaces with no physical meaning, corrupt definitions.

## 13. Preflight warns — it does not play for the user

Preflight reports (✓ networks connected, ⚠ magnet protection missing, ⚠ cooling margin low,
⚠ pressure rating below operating pressure) and always offers ACTIVATE ANYWAY unless the
design cannot be simulated because its data is malformed. Explain the problem ("Required
coolant flow exceeds this loop's predicted flow"); never prescribe a part ("Replace Pump A
with Pump B"). The user chooses the fix.

## 14. Connections are engineering objects

Where applicable a connection has endpoints, path, length, diameter or cross-section,
material, temperature/pressure/voltage/current ratings, electrical and fluid resistance,
insulation and state. Cables, pipes, ducts, fuel lines, control cables, shafts and joints
can affect physics through their geometry and properties.

## 15. Automatic routing is a convenience layer

Beginner: connect A to B and ForgeLab routes it. Advanced: edit the route (rack height, bend
radius, obstacle avoidance, waypoints, trays, racks, reset). Routing never changes the
physical endpoint semantics.

## 16. Materials are real sourced data

Never add numbers to make gameplay easier or a scenario pass. Each important value carries
value, SI unit, source, conditions, confidence and caveats. Missing data is represented as
missing — never `0` for "unknown".

## 17. Materials and components are different things

316L is a material; a coolant pump is a component — an assembly of regions (casing,
impeller, windings, shaft, bearings, seals, coolant). Do not confuse the material database
with the component catalogue.

## 18. Material selection is contextual

Show the physically meaningful materials first (structural for a beam, conductors for a
conductor, superconductors for a winding, insulators for insulation) and offer SHOW ALL
MATERIALS. Filtering is a UX aid and never alters physics.

## 19. The Material Lab has two depths

Quick card: name, category, key properties, tradeoffs, USE / MORE DETAILS. Detailed view:
grade, mechanical, thermal, electrical, magnetic, superconducting, nuclear, plasma-facing,
sources, conditions, confidence, curves, limitations.

## 20. Internal regions are first-class

Finished machines may contain structure, conductor, superconductor, insulation, magnetic
core, coolant, cryogen, vacuum, moving machinery, fuel, plasma-facing and breeder material,
sensors and electronics. The player does not assemble these; advanced inspection reveals
them.

## 21. Say when internal geometry is schematic

If exact industrial construction is unknown, show SCHEMATIC INTERNAL REPRESENTATION. Never
imply a simplified cutaway is a manufacturer design. Physical-model confidence and visual
confidence are separate, and both are honest.

## 22. Component interaction depth

Quick (name, status, connections, key rating) → Connections (ports, connected equipment,
networks) → Performance (live values, ratings, utilization, margin) → Inside (regions,
materials, fluids) → Failure limits → Advanced (full values and model assumptions).

## 23. Failure is part of the game loop

A failure should make the player think "What happened?" — and ForgeLab answers. Failures
are physically caused, visually distinct, temporally understandable, diagnosable and
replayable.

## 24. Failures have causal chains

Do not collapse a cascade into one string. Undersized conductor → resistive heating →
temperature rise → insulation damage → arc → breaker trip → magnet power lost → field
collapse → plasma disruption. Each step records timestamp, component, quantity, measured
value, limit and causal parent.

## 25. A causal graph, not only a line

Failures branch (a pipe rupture causes both pressure loss and inventory loss). Store causal
relationships explicitly; do not force them into one artificial chain.

## 26. Failure timeline

Where data exists, make the sequence legible with timestamps (NPSH margin falls → cavitation
→ head falls → flow below requirement → magnet margin exhausted → quench → field falls →
disruption). One of ForgeLab's most important teaching systems.

## 27. Presentation matches the physical failure

Electrical ≠ pipe rupture ≠ quench ≠ structural collapse ≠ disruption. Arcs, sparks and
breakers; directional fluid release and pressure decay; resistive heating, energy dump,
boil-off and field collapse; deformation, debris and load-path consequences; instability,
local wall interaction and extinction. Never one generic explosion.

## 28. Fire requires fuel

Combustible material plus ignition. Transformer oil, cable insulation, lubricant — not
steel or tungsten fireballs. Fusion plants do not detonate like weapons.

## 29. Damage reveals the machine

A broken casing reveals meaningful internals (winding, shaft, motor, pipes, insulation,
coolant path), not empty geometry.

## 30. Design state ≠ run state (protected)

ACTIVATE snapshots the design and simulates a copy; damage, destruction and replay live in
the run. RETURN TO BUILD restores the exact pre-run design. Persistent damage may only
exist in a future, explicitly chosen mode.

## 31. Community assemblies

Reusable groups of components and connections (a coolant loop, a magnet power module, a
cryogenic skid, a coil array, a turbine-generator package) can be saved, duplicated,
shared and forked with internal links intact.

## 32. Community validation does not mean "it works"

Publication validation checks the data: schema, known component and material ids, no
corrupt references, valid ports, deterministic serialization, the simulation can load it,
no forbidden data or malicious markup, compatible save/model version. It does NOT require
successful operation, positive net power, no warnings or no failures. A deliberately
terrible reactor — a beautifully engineered disaster — is valid community content.
If useful, classify separately: simulation valid, runs successfully, fails during test, not
yet run, experimental model. Never confuse file validity with engineering quality.

## 33. Community content shows model context

Published designs record the simulation version, component-definition version,
material-data version and model confidence, so a physics update never silently makes an old
result look equivalent to a new one.

## 34. Building speed is a feature

Drag-and-drop, snap placement, two-click connection, automatic routing, duplicate, mirror,
radial and linear arrays, groups, saved assemblies, subsystem copy, measurement. A
complicated model is acceptable; a complicated basic interaction is not.

## 35. Pattern tools are essential for fusion

Radial array, linear array, mirror, duplicate around an axis, duplicate along a path. Nobody
should place 24 identical coils by hand.

## 36. Spatial physics stays spatial

Fields, neutrons, radiation, gravity, radiative heat and collisions operate through
geometry. Reduced spatial models are acceptable; fake network edges are not.

## 37. Free-form construction is the long-term architecture

Reactor type names are not the source of physical truth. Avoid
`if (reactorType === "tokamak")`. Prefer: chamber geometry + magnet geometry + vacuum +
fuel + heating + materials + cooling + structure + electrical + controls → physical
behaviour. A named template may initialize geometry; it never defines reality.

## 38. Model confidence is required

SUPPORTED inside a well-supported reduced model; APPROXIMATE with significant assumptions;
EXPERIMENTAL outside validated ranges; UNSUPPORTED when ForgeLab cannot calculate it.
"This model cannot estimate confinement for this topology yet" is a valid, preferable
answer to an invented number.

## 39. Quantum physics stays under the engineering model

No wavefunctions or particle-by-particle simulation in normal gameplay. Use
quantum/nuclear-derived engineering relationships: fusion reactivity, superconducting
critical surfaces, cross sections, breeding, material damage.

## 40. Audio observes the simulation

Audio responds to RPM, flow, load, current, field, pressure, temperature, failure events and
machine state; it never determines physics. Plasma in vacuum does not roar; any plasma sound
is labelled diagnostic sonification.

## 41. Graphics quality never changes physics

LOW / MEDIUM / HIGH / ULTRA change particles, shadows, post-processing, debris detail, LOD and
pixel ratio — never the step, equations, material properties, failure thresholds or
leaderboard results.

## 42. Determinism is protected

Same design, simulation version, scenario and inputs → same physical result. No random
simulation outcomes. Presentation variation uses deterministic seeded randomness.

## 43. Test every physical rule

Port compatibility, connection ratings, material curves, pressure boundaries,
superconductor limits, startup/shutdown, routing data, failure chains, save migrations,
determinism. Do not depend on visual inspection alone.

## 44. Visual features also need verification

Correct component, event, origin, sequence, reset and cutaway behaviour. Use
screenshot/visual regression testing where practical. Compiling is not done.

## 45. Don't trust stale documentation

At the start of substantial work inspect the branch, HEAD, CI and code, then the planning
documents. Code and tests outrank an old "missing" table. Update documents as you
implement.

## 46. Don't rebuild work that exists

Before creating a subsystem, search for an existing implementation, tests, hooks and docs.
Extend it; never build a parallel system because an old prompt described something that
has since been implemented.

## 47. Small coherent commits

Schema → tests → implementation → UI → visuals → integration → docs. Keep the repository
runnable.

## 48. "Done" has a quality bar

Physics (meaningful behaviour), UX (understandable), visuals (intentional), audio (responds
where relevant), failure (fails meaningfully), diagnostics (ForgeLab explains why),
performance (within budget), tests (behaviour protected), documentation (assumptions
written down).

## 49. Never tune physics to make a demo pass

If a reference reactor fails, investigate why. Never change a real material property or
physical constant so a scenario succeeds. If the design is bad, the design is bad — that is
the product.

## 50. North star

ForgeLab should stop asking "What machine was the player trying to make?" and ask "What
physical system exists here?" — then calculate what it does. The player should spend their
time thinking "What if I build this?", not fighting the interface. When it fails, the
reaction should be "Why did that happen?" — followed immediately by ForgeLab showing
exactly why.

**BUILD FAST. PHYSICS DECIDES. FAILURES TEACH. ITERATION IS FAST. SHARE THE MACHINE.
SHARE THE FAILURE.**
