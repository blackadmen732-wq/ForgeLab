import type { ThreeEvent } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  type Group,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TorusGeometry,
  Vector2,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  type ComponentGeometry,
  type SimulationComponent,
  geometryLocalHalfExtentsM,
} from "@forgelab/sim-core";
import { findMaterialRecord } from "@forgelab/materials";
import { boxProjectUVs, partWearMaps } from "./environment/surfaces.js";
import { arcTube, machineModel } from "./machines.js";
import { createPlasmaMaterial } from "./plasma.js";

/**
 * Procedural presentation meshes.
 *
 * The body of every part is drawn from its physics geometry (box, cylinder, torus) with
 * the exact dimensions the engine uses. A few roles get presentation detail inside that
 * envelope — TF coils drawn as discrete coils, a plasma glow inside vessels — which is decoration only and never read by physics.
 */

export interface MeshHandle {
  readonly group: Group;
  /**
   * Holds every mesh of the part, inside `group`: precursor vibration (a cavitating pump,
   * an unstable plasma) offsets this, so it never fights the published position.
   */
  readonly shake: Group;
  readonly body: MeshStandardMaterial;
  readonly glow: Mesh | null;
  /** Spinning parts (pump couplings, turbine shafts), turned by the animator. */
  readonly rotor: Group | null;
  readonly rotorAxis: "x" | "y" | "z";
  /** Status lamp on machines that run; coloured by the animator in Simulate. */
  readonly lamp: Mesh | null;
  /** Trim and accent materials of the finished model (x-ray and cutaway apply to them). */
  readonly extras: readonly MeshStandardMaterial[];
}

/** Draws nothing but still takes pointer events: the envelope under a finished model. */
const PICK_MATERIAL = new MeshBasicMaterial({ visible: false });

const RUNNING_ROLES = new Set([
  "coolant-pump",
  "vacuum-pump",
  "turbine",
  "generator",
  "magnet-coil",
  "fuel-injector",
  "plasma-heater",
  "power-supply",
  "heat-exchanger",
  "controller",
]);

function halfExtents(geometry: ComponentGeometry): { x: number; y: number; z: number } {
  switch (geometry.kind) {
    case "box":
      return { x: geometry.sizeM.x / 2, y: geometry.sizeM.y / 2, z: geometry.sizeM.z / 2 };
    case "cylinder": {
      const r = geometry.radiusM;
      const h = geometry.heightM / 2;
      return geometry.axis === "x"
        ? { x: h, y: r, z: r }
        : geometry.axis === "z"
          ? { x: r, y: r, z: h }
          : { x: r, y: h, z: r };
    }
    case "torus": {
      const R = geometry.majorRadiusM + geometry.minorRadiusM;
      const a = geometry.minorRadiusM;
      return geometry.axis === "x"
        ? { x: a, y: R, z: R }
        : geometry.axis === "z"
          ? { x: R, y: R, z: a }
          : { x: R, y: a, z: R };
    }
    case "arc":
      return geometryLocalHalfExtentsM(geometry);
  }
}

/**
 * A spinning coupling for machines with a shaft: on top of pumps (vertical motor), on the
 * shaft ends of turbines and generators. Decoration inside the part's envelope margin.
 */
function rotorShape(
  role: string,
  geometry: ComponentGeometry,
): { geometry: BufferGeometry; axis: "x" | "y" | "z"; offset: [number, number, number] } | null {
  const h = halfExtents(geometry);
  if (role === "coolant-pump" || role === "vacuum-pump") {
    const r = Math.max(0.15, Math.min(h.x, h.z) * 0.6);
    const hub = new CylinderGeometry(r * 0.25, r * 0.25, 0.12, 16);
    const blades = [0, 1, 2, 3].map((i) =>
      new BoxGeometry(r * 2, 0.05, r * 0.22).rotateY((i * Math.PI) / 4),
    );
    const ring = new TorusGeometry(r, r * 0.06, 6, 32).rotateX(Math.PI / 2);
    const merged = mergeGeometries([hub, ...blades, ring]);
    [hub, ...blades, ring].forEach((g) => g.dispose());
    return merged === null ? null : { geometry: merged, axis: "y", offset: [0, h.y + 0.1, 0] };
  }
  if (role === "turbine" || role === "generator") {
    const axis: "x" | "z" = h.x >= h.z ? "x" : "z";
    const r = Math.max(0.2, Math.min(h.y, axis === "x" ? h.z : h.x) * 0.35);
    const length = 0.5;
    const shaft = new CylinderGeometry(r * 0.35, r * 0.35, length, 16);
    const flange = new CylinderGeometry(r, r, 0.1, 24).translate(0, length / 2, 0);
    const bolts = [0, 1, 2, 3, 4, 5].map((i) =>
      new BoxGeometry(r * 0.18, 0.14, r * 0.18)
        .translate(r * 0.75, length / 2, 0)
        .rotateY((i * Math.PI) / 3),
    );
    const parts = [shaft, flange, ...bolts];
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (merged === null) return null;
    if (axis === "x") merged.rotateZ(-Math.PI / 2);
    else merged.rotateX(Math.PI / 2);
    const end = (axis === "x" ? h.x : h.z) + length / 2;
    return {
      geometry: merged,
      axis,
      offset: axis === "x" ? [end, 0, 0] : [0, 0, end],
    };
  }
  return null;
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
    case "arc":
      return arcTube(
        geometry,
        geometry.radiusM,
        32,
        Math.max(12, Math.round(geometry.sweepRad * 24)),
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
    boxProjectUVs(g);
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
        castShadow
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

/** Shared worn-metal maps, as material parameters. */
function wear() {
  const maps = partWearMaps();
  return {
    map: maps.map,
    roughnessMap: maps.roughnessMap,
    normalMap: maps.normalMap,
    normalScale: new Vector2(0.5, 0.5),
  };
}

/**
 * Metalness and roughness from the material's presentation data. The wear map's roughness
 * averages about one half, so the base is doubled to keep the material's mean finish.
 */
function surfaceFinish(materialId: string | null): { metalness: number; roughness: number } {
  const p = materialId === null ? undefined : findMaterialRecord(materialId)?.presentation;
  return {
    metalness: p?.metalness ?? 0.35,
    roughness: Math.min(1, 2 * (p?.roughness ?? 0.55)),
  };
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
  // The finish (how metallic, how rough) is the material's own presentation data; the
  // shared wear maps add handling marks and streaks at real scale. Colour is set per frame
  // by the appearance driver.
  const finish = useMemo(() => surfaceFinish(component.materialId), [component.materialId]);
  const body = useMemo(() => new MeshStandardMaterial({ ...wear(), ...finish }), [finish]);
  const shape = useMemo(() => {
    const g = bodyGeometry(geometry);
    boxProjectUVs(g);
    return g;
  }, [geometry]);
  useLayoutEffect(() => () => shape.dispose(), [shape]);
  useLayoutEffect(() => () => body.dispose(), [body]);

  // Discrete coil ribs belong to a toroidal winding (a TF set), not a loop-wound coil.
  const ribs =
    role === "magnet-coil" &&
    geometry.kind === "torus" &&
    component.parameters["winding"] !== "loop";
  const model = useMemo(() => {
    const m = machineModel(component.type, geometry, component.connectionPoints);
    for (const g of [m?.main, m?.trim, m?.accent]) if (g) boxProjectUVs(g);
    return m;
  }, [component.type, geometry, component.connectionPoints]);
  const extras = useMemo(
    () => ({
      // Trim is bare machined/forged steel; accents are painted.
      trim: new MeshStandardMaterial({
        ...wear(),
        color: "#3a4047",
        metalness: 0.75,
        roughness: 0.42,
      }),
      accent: new MeshStandardMaterial({
        ...wear(),
        color: model?.accentColor ?? "#8a939e",
        metalness: 0.3,
        roughness: 0.48,
      }),
    }),
    [model],
  );
  useLayoutEffect(
    () => () => {
      model?.main?.dispose();
      model?.trim?.dispose();
      model?.accent?.dispose();
      extras.trim.dispose();
      extras.accent.dispose();
    },
    [model, extras],
  );
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
    () => createPlasmaMaterial(geometry.kind === "torus"),
    [geometry.kind],
  );
  useLayoutEffect(() => () => glowGeometry?.dispose(), [glowGeometry]);

  const rotorRef = useRef<Group>(null);
  const lampRef = useRef<Mesh>(null);
  const shakeRef = useRef<Group>(null);
  const rotor = useMemo(() => rotorShape(role, geometry), [role, geometry]);
  useLayoutEffect(() => () => rotor?.geometry.dispose(), [rotor]);
  const lamp = useMemo(() => {
    if (!RUNNING_ROLES.has(role)) return null;
    const h = halfExtents(geometry);
    return {
      geometry: new BoxGeometry(0.28, 0.12, 0.28),
      material: new MeshBasicMaterial({ color: "#1b1f24", toneMapped: false }),
      position: [h.x * 0.6, h.y + 0.06, h.z * 0.6] as [number, number, number],
    };
  }, [role, geometry]);
  useLayoutEffect(
    () => () => {
      lamp?.geometry.dispose();
      lamp?.material.dispose();
    },
    [lamp],
  );
  useLayoutEffect(() => () => glowMaterial.dispose(), [glowMaterial]);

  useLayoutEffect(() => {
    const g = group.current;
    if (g === null) return;
    const { positionM: p, rotation: q } = component.state.physical;
    g.position.set(p.x, p.y, p.z);
    g.quaternion.set(q.x, q.y, q.z, q.w);
    meshRegistry.set(component.id, {
      group: g,
      shake: shakeRef.current!,
      body,
      glow: glow.current,
      rotor: rotorRef.current,
      rotorAxis: rotor?.axis ?? "y",
      lamp: lampRef.current,
      extras: [extras.trim, extras.accent],
    });
    return () => {
      if (meshRegistry.get(component.id)?.group === g) meshRegistry.delete(component.id);
    };
  }, [component, body, rotor, lamp, extras]);

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
      <group ref={shakeRef}>
        {ribs ? (
          <group {...handlers}>
            <CoilRibs geometry={geometry} material={body} />
          </group>
        ) : (
          <mesh
            geometry={shape}
            material={model?.replacesEnvelope ? PICK_MATERIAL : body}
            castShadow={!model?.replacesEnvelope}
            receiveShadow
            {...handlers}
          >
            {selected && <Edges threshold={30} color="#6fd3d1" />}
          </mesh>
        )}
        {model?.main && (
          <mesh geometry={model.main} material={body} castShadow receiveShadow {...handlers} />
        )}
        {model?.trim && (
          <mesh
            geometry={model.trim}
            material={extras.trim}
            castShadow
            receiveShadow
            {...handlers}
          />
        )}
        {model?.accent && (
          <mesh
            geometry={model.accent}
            material={extras.accent}
            castShadow
            receiveShadow
            {...handlers}
          />
        )}
        {ribs && selected && (
          <mesh geometry={shape} visible={false}>
            <Edges threshold={50} color="#6fd3d1" />
          </mesh>
        )}
        {rotor !== null && (
          <group ref={rotorRef} position={rotor.offset}>
            <mesh geometry={rotor.geometry} material={body} castShadow />
          </group>
        )}
        {lamp !== null && (
          <mesh
            ref={lampRef}
            geometry={lamp.geometry}
            material={lamp.material}
            position={lamp.position}
            visible={false}
          />
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
    </group>
  );
});
