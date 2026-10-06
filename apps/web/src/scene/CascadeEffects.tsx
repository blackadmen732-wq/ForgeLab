import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import { Quaternion as ThreeQuaternion, Vector3 } from "three";
import type { CascadeSnapshot, HazardEmission, SimulationComponent } from "@forgelab/sim-core";
import type { HazardChannel } from "../state/store.js";
import { PHENOMENON_COLORS, hazardKindColor } from "./theme.js";

/**
 * Draws what the cascade solver says is happening.
 *
 * Nothing here decides anything physical. Each hazard the solver emitted is drawn as its
 * own phenomenon — a flame is orange, an arc is blue-white, steam is white, cryogenic fog
 * is pale blue — and sizes come from the solver's numbers through a display-only log
 * scale. If the solver emits no hazard, nothing is drawn.
 */
export function CascadeEffects({
  cascade,
  components,
  hazardView,
}: {
  readonly cascade: CascadeSnapshot;
  readonly components: readonly SimulationComponent[];
  readonly hazardView: HazardChannel;
}) {
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);

  return (
    <group>
      {cascade.hazards.map((hazard) => (
        <HazardVisual key={`${hazard.id}:${hazard.kind}`} hazard={hazard} />
      ))}

      {cascade.nodes
        .filter(
          (n) =>
            n.plasma !== undefined && n.plasma.state !== "off" && n.plasma.state !== "disrupted",
        )
        .map((n) => {
          const c = byId.get(n.componentId);
          if (c === undefined) return null;
          return (
            <PlasmaGlow
              key={`plasma-${n.componentId}`}
              position={c.state.physical.positionM}
              strength={n.plasma!.energyFraction}
            />
          );
        })}

      {cascade.debris.map((parcel) => (
        <mesh
          key={parcel.id}
          position={[parcel.positionM.x, parcel.positionM.y, parcel.positionM.z]}
        >
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial
            color={parcel.molten ? PHENOMENON_COLORS.molten : PHENOMENON_COLORS.flame}
          />
        </mesh>
      ))}

      {hazardView !== "off" && <HazardOverlay cascade={cascade} channel={hazardView} />}
    </group>
  );
}

/** Display-only size from a power: log scale so a 10 kW arc and a 5 MW fire both read. */
function displaySize(powerW: number, base: number): number {
  return base * Math.max(0.4, Math.log10(Math.max(powerW, 1)) - 3);
}

function HazardVisual({ hazard }: { readonly hazard: HazardEmission }) {
  const o = hazard.originM;
  switch (hazard.kind) {
    case "flame":
      return (
        <Flame
          position={[o.x, o.y, o.z]}
          radius={hazard.sourceRadiusM}
          powerW={hazard.radiantPowerW + hazard.convectivePowerW}
        />
      );
    case "smoke":
      return (
        <mesh position={[o.x, o.y + hazard.sourceRadiusM + 0.6, o.z]}>
          <sphereGeometry args={[hazard.sourceRadiusM + 0.6, 16, 12]} />
          <meshStandardMaterial
            color={PHENOMENON_COLORS.smoke}
            transparent
            opacity={0.55}
            depthWrite={false}
          />
        </mesh>
      );
    case "electric-arc":
      return <Arc position={[o.x, o.y, o.z]} />;
    case "fluid-jet":
      return hazard.directionM === undefined ? null : <SteamJet hazard={hazard} />;
    case "cryogenic-gas":
      return (
        <mesh position={[o.x, o.y + 0.05, o.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[hazard.reachM, 32]} />
          <meshBasicMaterial
            color={PHENOMENON_COLORS.cryoFog}
            transparent
            opacity={0.28}
            depthWrite={false}
          />
        </mesh>
      );
    case "hot-gas":
      return (
        <mesh position={[o.x, o.y + 0.5, o.z]}>
          <coneGeometry args={[0.35, 1.2, 16, 1, true]} />
          <meshBasicMaterial
            color={PHENOMENON_COLORS.ventGas}
            transparent
            opacity={0.3}
            depthWrite={false}
          />
        </mesh>
      );
    case "plasma-wall-heat":
      return (
        <mesh position={[o.x, o.y, o.z]}>
          <sphereGeometry args={[hazard.sourceRadiusM, 24, 16]} />
          <meshBasicMaterial
            color={PHENOMENON_COLORS.plasmaFlash}
            transparent
            opacity={0.8}
            depthWrite={false}
          />
        </mesh>
      );
    default:
      return null;
  }
}

function Flame({
  position,
  radius,
  powerW,
}: {
  position: [number, number, number];
  radius: number;
  powerW: number;
}) {
  const group = useRef<Group>(null);
  const height = displaySize(powerW, 0.9);
  const phase = position[0] * 3.1 + position[2] * 1.7;
  useFrame(({ clock }) => {
    if (group.current === null) return;
    const t = clock.getElapsedTime() * 9 + phase;
    group.current.scale.set(
      1 + 0.08 * Math.sin(t * 1.3),
      1 + 0.15 * Math.sin(t),
      1 + 0.08 * Math.cos(t * 1.1),
    );
  });
  return (
    <group ref={group} position={position}>
      <mesh position={[0, height / 2, 0]}>
        <coneGeometry args={[Math.max(radius, 0.25), height, 20, 1, true]} />
        <meshBasicMaterial
          color={PHENOMENON_COLORS.flame}
          transparent
          opacity={0.75}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, height / 3, 0]}>
        <coneGeometry args={[Math.max(radius, 0.25) * 0.55, height * 0.65, 16, 1, true]} />
        <meshBasicMaterial
          color={PHENOMENON_COLORS.flameCore}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>
      <pointLight
        color={PHENOMENON_COLORS.flame}
        intensity={Math.min(height * 6, 40)}
        distance={12}
        decay={2}
      />
    </group>
  );
}

function Arc({ position }: { position: [number, number, number] }) {
  const mesh = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (mesh.current === null) return;
    const flicker = 0.6 + 0.4 * Math.abs(Math.sin(clock.getElapsedTime() * 47));
    mesh.current.scale.setScalar(flicker);
  });
  return (
    <group position={position}>
      <mesh ref={mesh}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshBasicMaterial color={PHENOMENON_COLORS.arc} />
      </mesh>
      <pointLight color={PHENOMENON_COLORS.arc} intensity={25} distance={8} decay={2} />
    </group>
  );
}

function SteamJet({ hazard }: { readonly hazard: HazardEmission }) {
  const length = Math.min(Math.max(hazard.reachM, 1), 8);
  const dir = hazard.directionM!;
  const quaternion = useMemo(() => {
    const q = new ThreeQuaternion();
    q.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dir.x, dir.y, dir.z).normalize());
    return q;
  }, [dir.x, dir.y, dir.z]);
  const o = hazard.originM;
  const center: [number, number, number] = [
    o.x + (dir.x * length) / 2,
    o.y + (dir.y * length) / 2,
    o.z + (dir.z * length) / 2,
  ];
  return (
    <mesh position={center} quaternion={quaternion}>
      <coneGeometry args={[length * Math.tan((15 * Math.PI) / 180), length, 20, 1, true]} />
      <meshBasicMaterial
        color={PHENOMENON_COLORS.steam}
        transparent
        opacity={0.45}
        depthWrite={false}
      />
    </mesh>
  );
}

function PlasmaGlow({
  position,
  strength,
}: {
  position: { x: number; y: number; z: number };
  strength: number;
}) {
  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh>
        <sphereGeometry args={[0.9, 24, 16]} />
        <meshBasicMaterial
          color={PHENOMENON_COLORS.plasma}
          transparent
          opacity={0.25 + 0.4 * strength}
          depthWrite={false}
        />
      </mesh>
      <pointLight
        color={PHENOMENON_COLORS.plasma}
        intensity={8 * strength}
        distance={6}
        decay={2}
      />
    </group>
  );
}

/** Hazards whose reach is drawn for each channel (radiant uses flux contours instead). */
const CHANNEL_KINDS: Record<Exclude<HazardChannel, "off" | "gas-cloud">, readonly string[]> = {
  radiant: [],
  "hot-gas": [],
  fire: [],
  pressure: ["pressure-wave"],
  debris: [],
  electrical: ["electric-arc"],
};

/** Engineering overlay: the reach of each relevant hazard, and accumulated gas. */
function HazardOverlay({
  cascade,
  channel,
}: {
  readonly cascade: CascadeSnapshot;
  readonly channel: HazardChannel;
}) {
  if (channel === "gas-cloud") {
    return (
      <>
        {cascade.enclosures.map((e) => {
          const fraction = Math.min(
            e.flammableVolumeFraction / Math.max(e.lowerFlammabilityLimit, 1e-6),
            1,
          );
          const totalGasKg = Object.values(e.gasMassKg).reduce((sum, kg) => sum + kg, 0);
          if (totalGasKg <= 0) return null;
          const size: [number, number, number] = [
            e.maxM.x - e.minM.x,
            e.maxM.y - e.minM.y,
            e.maxM.z - e.minM.z,
          ];
          const center: [number, number, number] = [
            (e.maxM.x + e.minM.x) / 2,
            (e.maxM.y + e.minM.y) / 2,
            (e.maxM.z + e.minM.z) / 2,
          ];
          return (
            <group key={e.id} position={center}>
              <mesh>
                <boxGeometry args={size} />
                <meshBasicMaterial
                  color={hazardKindColor("hot-gas")}
                  transparent
                  opacity={0.04 + 0.4 * fraction}
                  depthWrite={false}
                />
              </mesh>
              <mesh>
                <boxGeometry args={size} />
                <meshBasicMaterial
                  color={hazardKindColor("hot-gas")}
                  wireframe
                  transparent
                  opacity={0.3}
                />
              </mesh>
            </group>
          );
        })}
      </>
    );
  }
  const kinds = channel === "off" ? [] : CHANNEL_KINDS[channel];
  if (channel === "radiant") {
    return (
      <>
        {cascade.hazards.flatMap((h) =>
          (h.radiantContoursM ?? []).map((c, i) => (
            <mesh
              key={`contour-${h.id}-${h.kind}-${c.fluxWm2}`}
              position={[h.originM.x, h.originM.y, h.originM.z]}
            >
              <sphereGeometry args={[c.radiusM, 24, 16]} />
              <meshBasicMaterial
                color={hazardKindColor(h.kind)}
                wireframe
                transparent
                opacity={i === 0 ? 0.45 : 0.18}
              />
            </mesh>
          )),
        )}
      </>
    );
  }
  return (
    <>
      {cascade.hazards
        .filter((h) => kinds.includes(h.kind) && h.reachM > 0)
        .map((h) => (
          <mesh key={`reach-${h.id}-${h.kind}`} position={[h.originM.x, h.originM.y, h.originM.z]}>
            <sphereGeometry args={[Math.min(h.reachM, 25), 24, 16]} />
            <meshBasicMaterial
              color={hazardKindColor(h.kind)}
              wireframe
              transparent
              opacity={0.25}
            />
          </mesh>
        ))}
    </>
  );
}
