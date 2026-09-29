import type { ThreeEvent } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  type Group,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TorusGeometry,
} from "three";
import type { ComponentGeometry, SimulationComponent } from "@forgelab/sim-core";

/**
 * Procedural presentation meshes.
 *
 * The body of every part is drawn from its physics geometry (box, cylinder, torus) with
 * the exact dimensions the engine uses. A few roles get presentation detail inside that
 * envelope — TF coils drawn as discrete coils, a plasma glow inside vessels — which is decoration only and never read by physics.
 */

export interface MeshHandle {
  readonly group: Group;
  readonly body: MeshStandardMaterial;
  readonly glow: Mesh | null;
}

/** id → live objects, written by the meshes and read by the appearance driver. */
export const meshRegistry = new Map<string, MeshHandle>();

/** Ids the gizmo is dragging: the appearance driver leaves their transforms alone. */
const draggingIds = new Set<string>();
export function setDragging(ids: Iterable<string>): void {
  draggingIds.clear();
  for (const id of ids) draggingIds.add(id);
}
export function isDragging(id: string): boolean {
  return draggingIds.has(id);
}

function orient(
  geometry: BufferGeometry,
  axis: "x" | "y" | "z",
  nativeAxis: "y" | "z",
): BufferGeometry {
  if (nativeAxis === "y") {
    if (axis === "x") geometry.rotateZ(Math.PI / 2);
    if (axis === "z") geometry.rotateX(Math.PI / 2);
  } else {
    if (axis === "y") geometry.rotateX(Math.PI / 2);
    if (axis === "x") geometry.rotateY(Math.PI / 2);
  }
  return geometry;
}

export function bodyGeometry(geometry: ComponentGeometry): BufferGeometry {
  switch (geometry.kind) {
    case "box":
      return new BoxGeometry(geometry.sizeM.x, geometry.sizeM.y, geometry.sizeM.z);
    case "cylinder": {
      const segments = geometry.radiusM > 2 ? 64 : 32;
      return orient(
        new CylinderGeometry(geometry.radiusM, geometry.radiusM, geometry.heightM, segments),
        geometry.axis,
        "y",
      );
    }
    case "torus":
      return orient(
        new TorusGeometry(geometry.majorRadiusM, geometry.minorRadiusM, 32, 96),
        geometry.axis,
        "z",
      );
  }
}

/** TF coils as `count` discrete coils around the torus, filling the same envelope. */
function CoilRibs({
  geometry,
  material,
  count = 18,
}: {
  geometry: Extract<ComponentGeometry, { kind: "torus" }>;
  material: MeshStandardMaterial;
  count?: number;
}) {
  const thickness = Math.min(
    geometry.wallThicknessM ?? geometry.minorRadiusM * 0.15,
    geometry.minorRadiusM * 0.5,
  );
  const ring = useMemo(() => {
    const g = new TorusGeometry(geometry.minorRadiusM - thickness / 2, thickness / 2, 12, 48);
    return g;
  }, [geometry.minorRadiusM, thickness]);
  useLayoutEffect(() => () => ring.dispose(), [ring]);
  const rings = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    rings.push(
      <mesh
        key={i}
        geometry={ring}
        material={material}
        position={[
          Math.cos(angle) * geometry.majorRadiusM,
          0,
          Math.sin(angle) * geometry.majorRadiusM,
        ]}
        rotation={[0, -angle, 0]}
      />,
    );
  }
  return (
    <group
      rotation={
        geometry.axis === "x"
          ? [0, 0, Math.PI / 2]
          : geometry.axis === "z"
            ? [Math.PI / 2, 0, 0]
            : [0, 0, 0]
      }
    >
      {rings}
    </group>
  );
}

export interface ComponentMeshProps {
  readonly component: SimulationComponent;
  readonly selected: boolean;
  readonly visible: boolean;
  readonly onPick: (id: string, event: ThreeEvent<MouseEvent>) => void;
  readonly onHover: (id: string | null) => void;
}

export const ComponentMesh = memo(function ComponentMesh({
  component,
  selected,
  visible,
  onPick,
  onHover,
}: ComponentMeshProps) {
  const group = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const geometry = component.geometry;
  const role = component.role;
  const body = useMemo(() => new MeshStandardMaterial({ metalness: 0.35, roughness: 0.55 }), []);
  const shape = useMemo(() => bodyGeometry(geometry), [geometry]);
  useLayoutEffect(() => () => shape.dispose(), [shape]);
  useLayoutEffect(() => () => body.dispose(), [body]);

  const ribs = role === "magnet-coil" && geometry.kind === "torus";
  const glowGeometry = useMemo(
    () =>
      role === "vacuum-vessel" && geometry.kind === "torus"
        ? orient(
            new TorusGeometry(geometry.majorRadiusM, geometry.minorRadiusM * 0.72, 24, 96),
            geometry.axis,
            "z",
          )
        : role === "vacuum-vessel" && geometry.kind === "cylinder"
          ? orient(
              new CylinderGeometry(
                geometry.radiusM * 0.45,
                geometry.radiusM * 0.45,
                geometry.heightM * 0.8,
                24,
              ),
              geometry.axis,
              "y",
            )
          : null,
    [role, geometry],
  );
  const glowMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: "#f472b6",
        transparent: true,
        opacity: 0.6,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  useLayoutEffect(() => () => glowGeometry?.dispose(), [glowGeometry]);
  useLayoutEffect(() => () => glowMaterial.dispose(), [glowMaterial]);

  useLayoutEffect(() => {
    const g = group.current;
    if (g === null) return;
    const { positionM: p, rotation: q } = component.state.physical;
    g.position.set(p.x, p.y, p.z);
    g.quaternion.set(q.x, q.y, q.z, q.w);
    meshRegistry.set(component.id, { group: g, body, glow: glow.current });
    return () => {
      if (meshRegistry.get(component.id)?.group === g) meshRegistry.delete(component.id);
    };
  }, [component, body]);

  const handlers = {
    onClick: (event: ThreeEvent<MouseEvent>) => {
      if (event.delta > 4) return;
      event.stopPropagation();
      onPick(component.id, event);
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      onHover(component.id);
    },
    onPointerOut: () => onHover(null),
  };

  return (
    <group ref={group} visible={visible} userData={{ componentId: component.id }}>
      {ribs ? (
        <group {...handlers}>
          <CoilRibs geometry={geometry} material={body} />
        </group>
      ) : (
        <mesh geometry={shape} material={body} {...handlers}>
          {selected && <Edges threshold={30} color="#6fd3d1" />}
        </mesh>
      )}
      {ribs && selected && (
        <mesh geometry={shape} visible={false}>
          <Edges threshold={50} color="#6fd3d1" />
        </mesh>
      )}
      {glowGeometry !== null && (
        <mesh
          ref={glow}
          geometry={glowGeometry}
          material={glowMaterial}
          visible={false}
          renderOrder={2}
        />
      )}
    </group>
  );
});
