import { MaterialIds, type MaterialId } from "@forgelab/materials";
import { QuaternionMath, transform, vec3 } from "@forgelab/shared";
import type { SimulationWorld } from "@forgelab/sim-core";
import { getComponentDefinition } from "@forgelab/reactor-components";

/** Corner sockets on the underside of a platform, paired with their x/z offsets. */
const PLATFORM_CORNERS = [
  ["bottom-nx-nz", -2.7, -2.7],
  ["bottom-nx-pz", -2.7, 2.7],
  ["bottom-px-nz", 2.7, -2.7],
  ["bottom-px-pz", 2.7, 2.7],
] as const;

const UPRIGHT = QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);

/** A platform on four legs with a vessel on the deck, built from catalogue parts only. */
function buildRig(
  world: SimulationWorld,
  options: { legMaterialId: MaterialId; chamberContentsKg: number },
): void {
  place(world, "structural-platform", { id: "platform", position: vec3(0, 4.1, 0) });

  for (const [socket, x, z] of PLATFORM_CORNERS) {
    const legId = `leg-${socket}`;
    place(world, "structural-beam", {
      id: legId,
      transform: transform(vec3(x, 2, z), UPRIGHT),
      materialId: options.legMaterialId,
    });
    world.connect(
      { componentId: "platform", connectionPointId: socket },
      { componentId: legId, connectionPointId: "end-b" },
    );
  }

  place(world, "reactor-chamber", {
    id: "chamber",
    position: vec3(0, 5.7, 0),
    additionalMassKg: options.chamberContentsKg,
  });
  world.connect(
    { componentId: "chamber", connectionPointId: "base" },
    { componentId: "platform", connectionPointId: "top" },
  );
}

/**
 * The scene the workspace opens on: a steel rig carrying an empty vessel, plus a loose
 * equipment block on the ground. Everything is comfortably within capacity.
 */
export function buildStarterAssembly(world: SimulationWorld): void {
  buildRig(world, { legMaterialId: MaterialIds.StructuralSteel, chamberContentsKg: 0 });
  place(world, "equipment-block", { id: "equipment", position: vec3(6, 0.5, 4) });
  world.solve();
}

/**
 * The same rig with copper legs and a heavily filled vessel.
 *
 * The numbers are not tuned to fail: copper's 69 MPa yield is simply the wrong material
 * for a 150 x 150 x 8 SHS column carrying this load, and 110 t of contents in a 21 m^3
 * vessel is a plausible shielded inventory. The solver works that out on its own.
 */
export function buildOverloadDemo(world: SimulationWorld): void {
  buildRig(world, { legMaterialId: MaterialIds.Copper, chamberContentsKg: 110_000 });
  world.solve();
}

function place(
  world: SimulationWorld,
  type: string,
  options: {
    id: string;
    position?: ReturnType<typeof vec3>;
    transform?: ReturnType<typeof transform>;
    materialId?: MaterialId;
    additionalMassKg?: number;
  },
): void {
  const definition = getComponentDefinition(type);
  world.addComponent(
    definition.createSpec({
      id: options.id,
      transform: options.transform ?? transform(options.position ?? vec3(0, 0, 0)),
      ...(options.materialId === undefined ? {} : { materialId: options.materialId }),
      ...(options.additionalMassKg === undefined
        ? {}
        : { additionalMassKg: options.additionalMassKg }),
    }),
  );
}
