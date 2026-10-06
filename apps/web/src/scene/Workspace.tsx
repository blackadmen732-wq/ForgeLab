import { Grid, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { QuaternionMath } from "@forgelab/shared";
import type { SimulationComponent } from "@forgelab/sim-core";
import { store, useStore, useUiState } from "../state/useStore.js";
import { CascadeEffects } from "./CascadeEffects.js";
import { ComponentMesh } from "./ComponentMesh.js";
import { CENTER_OF_MASS_COLOR, CONNECTION_COLOR } from "./theme.js";

/**
 * The 3D workspace.
 *
 * Every frame it hands the simulation the frame's elapsed time and then draws whatever
 * the simulation says is true. The frame rate decides how many fixed steps are due; it
 * never decides what a step computes.
 */
export function Workspace() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [16, 12, 18], fov: 45, near: 0.1, far: 2000 }}
      onPointerMissed={() => {
        store.select(null);
      }}
    >
      <color attach="background" args={["#0d1117"]} />
      <fog attach="fog" args={["#0d1117", 60, 220]} />

      <hemisphereLight args={["#8ea6c4", "#1b2430", 0.6]} />
      <directionalLight
        position={[24, 36, 18]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />

      <Grid
        args={[400, 400]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#1d2733"
        sectionSize={10}
        sectionThickness={1.1}
        sectionColor="#2d3d4f"
        fadeDistance={220}
        fadeStrength={1}
        infiniteGrid
        followCamera={false}
      />

      <SimulationDriver />
      <SceneContents />

      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2 - 0.02}
        minDistance={2}
        maxDistance={300}
        target={[0, 3, 0]}
      />
    </Canvas>
  );
}

/** The one place rendering touches the clock. */
function SimulationDriver() {
  const store = useStore();
  useFrame((_, delta) => {
    store.advance(delta);
  });
  return null;
}

function SceneContents() {
  const ui = useUiState();
  const cascade = ui.cascade;
  const nodes = useMemo(
    () => new Map(cascade?.nodes.map((n) => [n.componentId, n]) ?? []),
    [cascade],
  );
  const exposures = useMemo(
    () => new Map(cascade?.exposures.map((e) => [e.componentId, e]) ?? []),
    [cascade],
  );
  const lfl = cascade?.enclosures[0]?.lowerFlammabilityLimit ?? 0.075;

  return (
    <group>
      {ui.components.map((component) => (
        <ComponentMesh
          key={component.id}
          component={component}
          selected={component.id === ui.selectedId}
          gizmoMode={ui.gizmoMode}
          cascadeNode={nodes.get(component.id)}
          exposure={exposures.get(component.id)}
          hazardView={ui.hazardView}
          lowerFlammabilityLimit={lfl}
        />
      ))}

      {cascade !== undefined && (
        <CascadeEffects cascade={cascade} components={ui.components} hazardView={ui.hazardView} />
      )}

      <ConnectionLines components={ui.components} />

      {ui.showCenterOfMass && ui.assembly.totalMassKg > 0 && (
        <CenterOfMassMarker
          position={[
            ui.assembly.centerOfMassM.x,
            ui.assembly.centerOfMassM.y,
            ui.assembly.centerOfMassM.z,
          ]}
        />
      )}
    </group>
  );
}

/** Draws each established connection as a line between the two sockets it joins. */
function ConnectionLines({ components }: { readonly components: readonly SimulationComponent[] }) {
  const segments = useMemo(() => {
    const byId = new Map(components.map((component) => [component.id, component]));
    const seen = new Set<string>();
    const lines: [number, number, number][][] = [];

    for (const component of components) {
      for (const connection of component.connections) {
        if (seen.has(connection.id)) continue;
        seen.add(connection.id);

        const from = byId.get(connection.from.componentId);
        const to = byId.get(connection.to.componentId);
        if (from === undefined || to === undefined) continue;

        const a = socketWorldPoint(from, connection.from.connectionPointId);
        const b = socketWorldPoint(to, connection.to.connectionPointId);
        if (a === null || b === null) continue;
        lines.push([a, b]);
      }
    }
    return lines;
    // `components` is a fresh immutable array whenever the simulation publishes.
  }, [components]);

  return (
    <>
      {segments.map((points, index) => (
        <Line
          key={index}
          points={points}
          color={CONNECTION_COLOR}
          lineWidth={2}
          transparent
          opacity={0.9}
        />
      ))}
    </>
  );
}

function socketWorldPoint(
  component: SimulationComponent,
  connectionPointId: string,
): [number, number, number] | null {
  const socket = component.connectionPoints.find((point) => point.id === connectionPointId);
  if (socket === undefined) return null;
  const { positionM, rotation } = component.state.physical;
  const rotated = QuaternionMath.rotateVec3(rotation, socket.localPosition);
  return [positionM.x + rotated.x, positionM.y + rotated.y, positionM.z + rotated.z];
}

/**
 * The assembly centre of mass, drawn as a marker with a plumb line to the ground.
 *
 * It matters more than it looks: once ForgeLab has rotating machinery and spacecraft,
 * where this point sits relative to the supports is the difference between a rig that
 * stands and one that tips over.
 */
function CenterOfMassMarker({ position }: { readonly position: [number, number, number] }) {
  return (
    <group>
      <mesh position={position}>
        <sphereGeometry args={[0.22, 20, 20]} />
        <meshBasicMaterial color={CENTER_OF_MASS_COLOR} />
      </mesh>
      <Line
        points={[position, [position[0], 0, position[2]]]}
        color={CENTER_OF_MASS_COLOR}
        lineWidth={1}
        dashed
        dashSize={0.25}
        gapSize={0.2}
        transparent
        opacity={0.7}
      />
      <mesh position={[position[0], 0.02, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.36, 24]} />
        <meshBasicMaterial color={CENTER_OF_MASS_COLOR} />
      </mesh>
    </group>
  );
}
