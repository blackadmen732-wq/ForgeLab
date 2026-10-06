import { TransformControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useState } from "react";
import type { Group } from "three";
import type { CascadeNodeState, ComponentExposure, SimulationComponent } from "@forgelab/sim-core";
import type { HazardChannel } from "../state/store.js";
import { useStore } from "../state/useStore.js";
import {
  FREE_BODY_COLOR,
  SELECTION_COLOR,
  STATUS_COLORS,
  hazardScaleColor,
  incandescentColor,
} from "./theme.js";

interface Props {
  readonly component: SimulationComponent;
  readonly selected: boolean;
  readonly gizmoMode: "translate" | "rotate";
  readonly cascadeNode?: CascadeNodeState | undefined;
  readonly exposure?: ComponentExposure | undefined;
  readonly hazardView?: HazardChannel;
  readonly lowerFlammabilityLimit?: number;
}

/**
 * Display normalisation for the hazard view: the value that maps to the top of the scale.
 * Presentation only — the solver never reads these.
 */
function hazardFraction(
  channel: HazardChannel,
  node: CascadeNodeState | undefined,
  exposure: ComponentExposure | undefined,
  lfl: number,
): number {
  if (exposure === undefined) return 0;
  switch (channel) {
    case "radiant":
      return exposure.radiantHeatFluxWm2 / 50_000;
    case "hot-gas":
      return (exposure.hotGasTemperatureK - 293.15) / 800;
    case "fire":
      return node?.conditions.includes("burning") === true
        ? 1
        : exposure.flameExposure
          ? 0.75
          : node?.conditions.includes("smoking") === true
            ? 0.45
            : 0;
    case "gas-cloud":
      return exposure.chemicalGasExposure / Math.max(lfl, 1e-6);
    case "pressure":
      return Math.max(exposure.peakOverpressurePa / 20_000, exposure.fluidJetLoadN / 5_000);
    case "debris":
      return exposure.debrisImpactEnergyJ / 5_000;
    case "electrical":
      return node?.electrical?.arcing === true
        ? 1
        : exposure.electricalFaultExposureW > 0
          ? 0.8
          : node?.electrical?.open === true
            ? 0.5
            : 0;
    case "off":
      return 0;
  }
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
export function ComponentMesh({
  component,
  selected,
  gizmoMode,
  cascadeNode,
  exposure,
  hazardView = "off",
  lowerFlammabilityLimit = 0.075,
}: Props) {
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
  const hazardOn = hazardView !== "off";
  const color = selected
    ? SELECTION_COLOR
    : hazardOn
      ? hazardScaleColor(hazardFraction(hazardView, cascadeNode, exposure, lowerFlammabilityLimit))
      : free
        ? FREE_BODY_COLOR
        : STATUS_COLORS[status];
  // Hot metal glows. The temperature is the solver's; only its look is decided here.
  const glow = incandescentColor(cascadeNode?.temperatureK ?? 0);
  const emissive = selected
    ? SELECTION_COLOR
    : !hazardOn && glow.intensity > 0
      ? glow.color
      : "#000000";
  const emissiveIntensity = selected ? 0.25 : !hazardOn ? glow.intensity : 0;

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
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            transparent={hazardOn}
            opacity={hazardOn ? 0.85 : 1}
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
