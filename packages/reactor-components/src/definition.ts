import { type MaterialId, getMaterial } from "@forgelab/materials";
import { type Newtons, type Transform, type Vec3 } from "@forgelab/shared";
import {
  type ComponentGeometry,
  type ComponentSpec,
  type ConnectionPoint,
  type ConnectionType,
  dominantLocalAxis,
  sectionAreaPerpendicularToLocalAxis,
} from "@forgelab/sim-core";

/** Options a builder supplies when placing one of the catalogue's components. */
export interface PlacementOptions {
  readonly id: string;
  readonly transform?: Transform;
  readonly materialId?: MaterialId;
  readonly label?: string;
  readonly anchored?: boolean;
  /** Contents the geometry does not model: coolant inventory, internals, ballast. */
  readonly additionalMassKg?: number;
}

/**
 * A component the player can place.
 *
 * A definition is a recipe, not an instance: it turns placement options into the
 * `ComponentSpec` that `SimulationWorld.addComponent` understands. Geometry and sockets
 * live here; mass, load and stress are all derived by the engine from the material id.
 */
export interface ComponentDefinition {
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly defaultMaterialId: MaterialId;
  /** Nominal bounding size, for palette previews and placement offsets. */
  readonly nominalSizeM: Vec3;
  createSpec(options: PlacementOptions): ComponentSpec;
}

/**
 * Rated capacity of a structural socket, in newtons.
 *
 * DOCUMENTED ASSUMPTION. ForgeLab has no joint database, so rather than invent a bolt
 * pattern it assumes *the joint is no stronger than the member it sits on*: capacity is
 * the member's own section area perpendicular to the socket normal, times the material's
 * yield strength. That is a real relationship built from real material data, and it is
 * deliberately optimistic about the joint and conservative about nothing else. A specific
 * flange, weld or bolt rating overrides it per connection.
 */
export function structuralSocketCapacityN(
  geometry: ComponentGeometry,
  localDirection: Vec3,
  materialId: MaterialId,
): Newtons {
  const areaM2 = sectionAreaPerpendicularToLocalAxis(geometry, dominantLocalAxis(localDirection));
  return areaM2 * getMaterial(materialId).yieldStrengthPa;
}

export interface SocketTemplate {
  readonly id: string;
  readonly localPosition: Vec3;
  readonly localDirection: Vec3;
  readonly connectionType: ConnectionType;
  /**
   * When true the socket's capacity is derived from the member section (see above).
   * Mount sockets leave it false: ForgeLab has no basis for a bolted-flange rating yet,
   * and an unrated socket imposes no limit rather than a made-up one.
   */
  readonly derivedCapacity: boolean;
}

export function buildConnectionPoints(
  templates: readonly SocketTemplate[],
  geometry: ComponentGeometry,
  materialId: MaterialId,
): readonly ConnectionPoint[] {
  return Object.freeze(
    templates.map((template) =>
      Object.freeze({
        id: template.id,
        localPosition: template.localPosition,
        localDirection: template.localDirection,
        connectionType: template.connectionType,
        ...(template.derivedCapacity
          ? {
              maxLoadN: structuralSocketCapacityN(geometry, template.localDirection, materialId),
            }
          : {}),
      }),
    ),
  );
}
