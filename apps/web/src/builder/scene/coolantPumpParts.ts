import { PUMP_CONSTRUCTION_RECIPE, boxGeometry, type ConnectionPoint } from "@forgelab/sim-core";
import { vec3 } from "@forgelab/shared";
import { buildCoolantPump } from "./coolantPump.js";
import type { MachineModel } from "./machines.js";

/** Split the existing detailed model, rather than maintain a second set of pump meshes. */
export function coolantPumpPartModel(
  type: string,
  points: readonly ConnectionPoint[],
): MachineModel | null {
  const part = PUMP_CONSTRUCTION_RECIPE.parts.find((p) => p.type === type);
  if (!part) return null;
  const full = boxGeometry(vec3(2, 2, 2), 0.04);
  const ports = points.map((p) => ({
    ...p,
    localPosition: vec3(
      p.localPosition.x + part.offset.x,
      p.localPosition.y + part.offset.y,
      p.localPosition.z + part.offset.z,
    ),
  }));
  const model = buildCoolantPump(full, ports, part.key);
  for (const g of [model.main, model.trim, model.accent])
    g?.translate(-part.offset.x, -part.offset.y, -part.offset.z);
  return model;
}
