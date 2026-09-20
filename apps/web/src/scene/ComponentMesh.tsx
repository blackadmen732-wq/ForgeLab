import { TransformControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useState } from "react";
import type { Group } from "three";
import type { SimulationComponent } from "@forgelab/sim-core";
import { useStore } from "../state/useStore.js";
import { FREE_BODY_COLOR, SELECTION_COLOR, STATUS_COLORS } from "./theme.js";

interface Props {
  readonly component: SimulationComponent;
  readonly selected: boolean;
  readonly gizmoMode: "translate" | "rotate";
}

/**
 * Draws one component.
 *
 * The group's transform is read from the simulation every frame and written straight onto
 * the Three.js object. Nothing here decides where anything is; it reflects what the engine
 * already computed. The one exception is while a gizmo drag is in progress, when the user
 * is authoring rather than watching — and that result is committed back to the world as a
 * command when the drag ends, so the world stays the only source of truth.
 *
 * The group is held in state rather than a ref so that mounting it re-renders and the
 * transform gizmo has a real object to attach to.
 */
export function ComponentMesh({ component, selected, gizmoMode }: Props) {
  const store = useStore();
  const [group, setGroup] = useState<Group | null>(null);
  const [dragging, setDragging] = useState(false);

  useFrame(() => {
    if (group === null || dragging) return;
    const live = store.world.getComponent(component.id);
    if (live === undefined) return;
    const { positionM, rotation } = live.state.physical;
    group.position.set(positionM.x, positionM.y, positionM.z);
    group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  });

  // Re-seat immediately on an edit, so a change is visible while the clock is paused.
  useEffect(() => {
    if (group === null) return;
    const { positionM, rotation } = component.state.physical;
    group.position.set(positionM.x, positionM.y, positionM.z);
    group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }, [group, component]);

  const status = component.state.structural.status;
  const free = component.state.support.mode === "free";
  const color = selected ? SELECTION_COLOR : free ? FREE_BODY_COLOR : STATUS_COLORS[status];

  return (
    <>
      <group ref={setGroup}>
        <mesh
          castShadow
          receiveShadow
          rotation={axisRotation(component)}
          onClick={(event) => {
            event.stopPropagation();
            store.select(component.id);
          }}
        >
          {component.geometry.kind === "box" ? (
            <boxGeometry
              args={[
                component.geometry.sizeM.x,
                component.geometry.sizeM.y,
                component.geometry.sizeM.z,
              ]}
            />
          ) : (
            <cylinderGeometry
              args={[
                component.geometry.radiusM,
                component.geometry.radiusM,
                component.geometry.heightM,
                36,
              ]}
            />
          )}
          <meshStandardMaterial
            color={color}
            metalness={0.55}
            roughness={0.45}
            emissive={selected ? SELECTION_COLOR : "#000000"}
            emissiveIntensity={selected ? 0.25 : 0}
          />
        </mesh>

        {component.anchored && (
          <mesh>
            <sphereGeometry args={[0.18, 12, 12]} />
            <meshBasicMaterial color="#e2e8f0" wireframe />
          </mesh>
        )}
      </group>

      {selected && group !== null && (
        <TransformControls
          object={group}
          mode={gizmoMode}
          size={0.85}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => {
            setDragging(false);
            store.setTransform(
              component.id,
              { x: group.position.x, y: group.position.y, z: group.position.z },
              {
                x: group.quaternion.x,
                y: group.quaternion.y,
                z: group.quaternion.z,
                w: group.quaternion.w,
              },
            );
          }}
        />
      )}
    </>
  );
}

/**
 * Three.js builds cylinders along +Y. A ForgeLab cylinder records which of its own local
 * axes it runs along, so the mesh is rotated to match the geometry rather than the other
 * way round.
 */
function axisRotation(component: SimulationComponent): [number, number, number] {
  if (component.geometry.kind !== "cylinder") return [0, 0, 0];
  switch (component.geometry.axis) {
    case "x":
      return [0, 0, Math.PI / 2];
    case "z":
      return [Math.PI / 2, 0, 0];
    case "y":
      return [0, 0, 0];
  }
}
