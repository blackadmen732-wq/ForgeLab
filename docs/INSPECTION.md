# Machines at true scale, and how to look inside them

ForgeLab builds machines at their real SI size and makes the world big enough to hold them,
instead of scaling parts up for spectacle. An ITER-class tokamak is about 30 m across and
tens of thousands of tonnes; a person beside it is 1.75 m. This document describes what the
builder offers for seeing such a machine as a whole, walking around it, and taking it apart
level by level. Everything here is presentation: none of it changes the design, the design
hash, the undo stack or anything the simulation computes.

## Scale

| Feature            | How                                              | Notes                                                                                                                                                           |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main hall          | 140 × 90 m floor, 50 m to the trusses, 56 m roof | Upper fittings follow the eave height (`hall/geometry.ts`).                                                                                                     |
| Scale reference    | **U**, or the person icon on the tool rail       | A 1.75 m worker in a hard hat, in front of the selection or the plant. Never picked.                                                                            |
| Walk               | **G**                                            | Eye height 1.7 m, on the floor in front of what you were looking at. W A S D, drag to look, Shift faster, Esc back to orbit.                                    |
| Fly                | **Shift G**                                      | Free flight, Q / E down and up, 6 m/s (30 m/s with Shift).                                                                                                      |
| Depth precision    | automatic                                        | The near plane follows the viewing distance (2 cm close up, up to 1 m across the hall).                                                                         |
| Detail by distance | automatic                                        | A part's fittings and trim show within 45 m + 14 × its radius (`scene/lod.ts`): a pump's flanges vanish past ~60 m; a cryostat's ribs never do inside the hall. |

### ITER-class plant (blueprint)

The reference machine at real size in its hall: TF set (R 6.2 m), blanket and vessel on
four 1.2 m steel gravity supports; six NbTi poloidal-field coils at ITER-like radii (3.9–12 m)
and heights; a Nb₃Sn central solenoid; a 29 m, 26 m tall 304L cryostat (≈3 000 t); heating,
fuelling, pumping, cooling, power conversion and electrical plant outside the cryostat wall;
a maintenance platform reached by a stair tower. About 17 500 t in 34 parts. Service runs
that pass through the cryostat wall are drawn with penetration sleeves where they cross it.

Honest limits:

- The TF set is a circular-section torus, not 18 D-shaped coils (custom D and racetrack coil
  paths are not available yet).
- PF coils and the central solenoid are pinned in place: in a real machine they are clamped to
  the TF coil cases, which ForgeLab does not model. Their fields are computed (Biot–Savart);
  model confidence states that the 0D plasma uses neither equilibrium nor flux swing.
- The cryostat is structure and mass only; its insulation vacuum and thermal shield are not
  modelled.
- There is no concrete basemat: the material library's concrete has no yield strength or
  service temperature, and ForgeLab does not invent them. Supports stand on the hall floor.
- No divertor part yet; exhaust heat lands on the vessel wall.

## Finding your way around a big machine

| Feature          | How                                                                  | What it does                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plant systems    | automatic                                                            | Every part belongs to a system derived from its role (and fluid, for pumps): structure, reactor core, magnets, cryogenics, cooling, vacuum, heating, fuel, electrical, controls, power conversion (`reactor-components/systems.ts`).                             |
| Plant tree       | **O**                                                                | Systems → part types → parts, with mass, plus the plant's centre of mass, load into the floor, largest support reaction and heaviest part. Click a part to select and frame it; selecting in 3D opens its branch.                                                |
| Isolate a system | target button in the tree, or the system in the Inspector breadcrumb | The system stays solid, everything else ghosts (service runs too). With X-ray on, the isolated system is what you see through the rest.                                                                                                                          |
| Breadcrumb       | top of the Inspector                                                 | Plant › system › part › region › material. Each step goes somewhere: the tree, the system on its own, the part framed, the material in the Material Lab.                                                                                                         |
| Materials view   | view menu → Materials                                                | Parts and internal regions coloured by the material library's families, with a text legend. Pick a material to light up every part containing it, seeing through casings when it is inside (Nb₃Sn in a coil); open it in the Material Lab.                       |
| Loads            | Inspector                                                            | A part's own weight, what rests on it, and the reaction into each support it bears on (grouped per support); for a selection or the whole plant, centre of mass, load into the floor, largest reaction, heaviest part. Read from sim-core's structural solution. |

## Taking it apart (Inspection views, **L**)

| View          | What it does                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section plane | One plane through the whole plant along X, Y or Z, keeping either side, positioned anywhere across the design. Every part is cut by the same plane and every machine's internals are shown, so a section reads like an engineering cutaway. Service runs are cut too.                                                                                               |
| Layers        | Peel the machine from the outside in: services hidden → cryostat hidden → magnets hidden → blanket hidden → vessel cut open towards the camera. The view frames what is left at each step.                                                                                                                                                                          |
| Exploded view | A slider from assembled to exploded. Nested shells (vessel, blanket, magnets, cryostat) lift apart in order; equipment beside the machine moves outward horizontally; parts above or below move up or down; structure stays so the machine lifts off its supports. Service runs are hidden while exploded, since they join where parts really are. Build mode only. |

Existing deeper views still apply: **Cutaway (X)** opens the selection towards the camera,
**Internal systems** shows every machine's regions by kind, and the Inspector's _Inside_ list
highlights one region and links its material to the Material Lab.

## Tests

`scene/inspection.test.ts` (peel order, explode directions, section side),
`reactor-components/systems.test.ts` (system classification), `ui/loads.test.ts` (load
summary against the plant's weight), `scene/materialView.test.ts`, `scene/penetrations.test.ts`,
`scene/lod.test.ts`, `store/editor.test.ts` (views never change the design hash or the undo
stack), `reactor-components/iter-class.test.ts` (mass, supports, model-limit wording,
determinism) and `builder/commands.test.ts` (no shortcut bound twice).
