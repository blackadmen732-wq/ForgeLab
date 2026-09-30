import { useFrame } from "@react-three/fiber";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  type DirectionalLight,
  type HemisphereLight,
  type InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type PointLight,
  Quaternion,
  Vector3,
} from "three";
import { PresentationContext } from "../../../../presentation/context.js";
import type { FacilityState } from "../../../../presentation/facility.js";
import { lightingTargets } from "../../../../presentation/lighting.js";
import {
  getSettings,
  motionAllowed,
  tierBudget,
  useSettings,
} from "../../../../presentation/settings.js";
import type { EnvironmentPreset } from "../presets.js";
import { concreteTexture, radialTexture, ribbedPanelTexture } from "../textures.js";
import {
  HALL,
  WALL_ZONES,
  buildHallGeometry,
  type Emitter,
  type Surface,
  type Zone,
} from "./geometry.js";

/* ------------------------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------------------------ */

type Materials = Record<Surface, Material> & { floor: MeshStandardMaterial };

function createMaterials(preset: EnvironmentPreset): Materials {
  const dark = preset.id === "dark-facility";
  const floorMap = concreteTexture(12, false);
  floorMap.repeat.set((2 * HALL.halfX) / 12, (2 * HALL.halfZ) / 12);
  const concreteMap = concreteTexture(12, false);
  concreteMap.repeat.set(4, 0.6);
  const panelMap = ribbedPanelTexture(4, 0.25);
  panelMap.repeat.set(35, 1);
  const std = (color: string, metalness: number, roughness: number, extra = {}) =>
    new MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const glow = (color: string, intensity: number) =>
    new MeshStandardMaterial({
      color: "#101216",
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.6,
    });
  return {
    floor: new MeshStandardMaterial({
      color: dark ? "#5c6168" : "#7d838b",
      map: floorMap,
      roughnessMap: floorMap,
      roughness: 1,
      metalness: 0,
    }),
    steel: std("#56616d", 0.55, 0.5),
    steelDark: std("#2b3137", 0.5, 0.6),
    concrete: std(dark ? "#6f747a" : "#9aa0a6", 0, 0.92, { map: concreteMap }),
    panel: std(dark ? "#5b636c" : "#7d8791", 0.3, 0.68, { map: panelMap }),
    glass: std("#0c1319", 0.9, 0.06, { transparent: true, opacity: 0.42, depthWrite: false }),
    interior: std("#40464d", 0, 0.9, {
      emissive: "#ffe7c4",
      emissiveIntensity: dark ? 0.05 : 0.08,
    }),
    interiorLit: glow("#fff1da", 1.4),
    screen: glow("#72b6db", 0.9),
    clerestory: glow("#bcd4ea", dark ? 0.05 : 0.5),
    door: std("#4d5660", 0.45, 0.55),
    accent: std("#2f5d8f", 0.35, 0.55),
    hazardDark: std("#141414", 0, 0.75),
    markings: std("#c79d2b", 0, 0.72),
    plates: std("#5d646b", 0.75, 0.42),
    duct: std("#9aa3ab", 0.75, 0.35),
    crane: std("#c3961f", 0.3, 0.5),
    rails: std("#c99d20", 0.3, 0.55),
    propRed: std("#98281f", 0.2, 0.55),
    propGreen: std("#2b7a4c", 0.2, 0.6),
    propGrey: std("#6a727b", 0.45, 0.55),
    propBlue: std("#2e4d76", 0.35, 0.55),
    rubber: std("#1a1c1f", 0, 0.9),
    roof: std("#14181d", 0, 0.95),
    baylight: glow("#ffeed6", 1.0),
  };
}

/* ------------------------------------------------------------------------------------ *
 * Instanced emitters
 * ------------------------------------------------------------------------------------ */

const WARM = new Color("#fff2dd");
const WORK = new Color("#ffe1b0");
const EMERGENCY = new Color("#ff3b2f");
const AMBER = new Color("#ffae1a");
const INDICATOR = {
  green: new Color("#33d17a"),
  amber: new Color("#ffb020"),
  red: new Color("#ff3b30"),
};
const scratch = new Color();
const m4 = new Matrix4();
const q = new Quaternion();
const one = new Vector3(1, 1, 1);

function placeInstances(
  mesh: InstancedMesh | null,
  emitters: readonly Emitter[],
  orient?: (e: Emitter) => Quaternion,
  scale = one,
): void {
  if (mesh === null) return;
  emitters.forEach((e, i) => {
    m4.compose(e.position, orient?.(e) ?? q.identity(), scale);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, scratch.setRGB(0, 0, 0));
  });
  mesh.count = emitters.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function setColors(mesh: InstancedMesh | null, n: number, color: (i: number, out: Color) => Color) {
  if (mesh === null || mesh.instanceColor === null) return;
  for (let i = 0; i < n; i += 1) mesh.setColorAt(i, color(i, scratch));
  mesh.instanceColor.needsUpdate = true;
}

/** Names of the environment's lights, which the facility controller dims and restores. */
export const HALL_LIGHT_NAMES = Object.freeze({
  key: "hall-key",
  fill: "hall-fill",
  hemisphere: "hall-hemisphere",
});

/* ------------------------------------------------------------------------------------ *
 * Hall
 * ------------------------------------------------------------------------------------ */

export function MainReactorHall({ preset }: { preset: EnvironmentPreset }) {
  const pools = tierBudget(useSettings()).lightPools;
  const hall = useMemo(() => buildHallGeometry(), []);
  useLayoutEffect(() => () => hall.meshes.forEach((m) => m.geometry.dispose()), [hall]);
  const materials = useMemo(() => createMaterials(preset), [preset]);
  useLayoutEffect(
    () => () => {
      for (const m of Object.values(materials)) {
        const s = m as MeshStandardMaterial;
        s.map?.dispose();
        m.dispose();
      }
    },
    [materials],
  );
  const shared = useMemo(() => {
    const radial = radialTexture();
    return {
      floorGeometry: new PlaneGeometry(2 * HALL.halfX, 2 * HALL.halfZ).rotateX(-Math.PI / 2),
      // Ground outside the walls, seen when a framed view puts the camera beyond them.
      apron: new PlaneGeometry(800, 800).rotateX(-Math.PI / 2).translate(0, -0.03, 0),
      lens: new CylinderGeometry(0.55, 0.55, 0.06, 18),
      pool: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      wash: new PlaneGeometry(1, 1),
      lamp: new BoxGeometry(0.5, 0.18, 0.12),
      beacon: new CylinderGeometry(0.22, 0.26, 0.42, 16),
      indicator: new BoxGeometry(0.06, 0.06, 0.02),
      lensMaterial: new MeshBasicMaterial({ toneMapped: false }),
      poolMaterial: new MeshBasicMaterial({
        map: radial,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
      lampMaterial: new MeshBasicMaterial({ toneMapped: false }),
      radial,
    };
  }, []);
  useLayoutEffect(
    () => () => {
      for (const value of Object.values(shared)) (value as { dispose(): void }).dispose();
    },
    [shared],
  );

  const zones = useRef<Partial<Record<Zone, { visible: boolean } | null>>>({});
  const lensesRef = useRef<InstancedMesh>(null);
  const poolsRef = useRef<InstancedMesh>(null);
  const workRef = useRef<InstancedMesh>(null);
  const washesRef = useRef<InstancedMesh>(null);
  const emergencyRef = useRef<InstancedMesh>(null);
  const beaconsRef = useRef<InstancedMesh>(null);
  const indicatorsRef = useRef<InstancedMesh>(null);
  const shockRef = useRef<PointLight>(null);

  useLayoutEffect(() => {
    placeInstances(lensesRef.current, hall.fixtures);
    placeInstances(
      poolsRef.current,
      hall.fixtures.map((f) => ({ ...f, position: new Vector3(f.position.x, 0.02, f.position.z) })),
      undefined,
      new Vector3(15, 1, 15),
    );
    placeInstances(workRef.current, hall.workLights, (e) =>
      q.setFromUnitVectors(new Vector3(0, 0, 1), (e as (typeof hall.workLights)[number]).normal),
    );
    placeInstances(
      washesRef.current,
      hall.workLights.map((w) => ({
        ...w,
        position: w.position
          .clone()
          .addScaledVector(w.normal, 0.05)
          .setY(w.position.y - 2.5),
      })),
      (e) =>
        q.setFromUnitVectors(new Vector3(0, 0, 1), (e as (typeof hall.workLights)[number]).normal),
      new Vector3(12, 10, 1),
    );
    placeInstances(emergencyRef.current, hall.emergency);
    placeInstances(beaconsRef.current, hall.beacons);
    placeInstances(indicatorsRef.current, hall.indicators);
  }, [hall]);

  // Facility lighting controller: follows the presentation director's facility state.
  const director = useContext(PresentationContext);
  const phase = useRef({
    state: "BUILD" as FacilityState,
    since: 0,
    flash: 0,
    flashAt: new Vector3(),
  });
  useEffect(() => {
    if (director === null) return;
    return director.on((event) => {
      if (event.type === "facility") {
        phase.current.state = event.state;
        phase.current.since = performance.now();
      } else if (event.type === "destruction" && !getSettings().reducedEffects) {
        const [x, y, z] = event.event.worldPosition;
        phase.current.flash = Math.max(phase.current.flash, event.event.severity);
        phase.current.flashAt.set(x, y + 2, z);
      } else if (event.type === "reset") {
        phase.current.flash = 0;
      }
    });
  }, [director]);
  useEffect(() => {
    if (director === null) return;
    phase.current.state = director.getState().facility;
  }, [director]);

  const current = useRef({ rows: [] as number[], key: 1, ambient: 1, emergency: 0, work: 1 });
  const fixtureRows = useMemo(() => Math.max(...hall.fixtures.map((f) => f.row)) + 1, [hall]);
  const lastTime = useRef(0);

  useFrame(({ camera, invalidate, scene }) => {
    // Hide whatever stands between the camera and the plant.
    const p = camera.position;
    const margin = 0.5;
    const hide: Record<string, boolean> = {
      north: p.z < -HALL.halfZ + margin,
      south: p.z > HALL.halfZ - margin,
      west: p.x < -HALL.halfX + margin,
      east: p.x > HALL.halfX - margin,
      overhead: p.y > HALL.eaveM - 1.5,
    };
    for (const zone of [...WALL_ZONES, "overhead" as const]) {
      const group = zones.current[zone];
      if (group) group.visible = !hide[zone];
    }

    const now = performance.now();
    if (lastTime.current === 0) lastTime.current = now;
    if (phase.current.since === 0) phase.current.since = now;
    const dt = Math.min(0.1, (now - lastTime.current) / 1000);
    lastTime.current = now;
    const settings = getSettings();
    const reduced = settings.reducedEffects;
    const elapsed = (now - phase.current.since) / 1000;
    const t = lightingTargets(phase.current.state, elapsed, reduced);
    const c = current.current;
    const ease = (from: number, to: number, rate: number) =>
      from + (to - from) * Math.min(1, dt * rate);
    const settle = (from: number, to: number, rate: number) => {
      const next = ease(from, to, rate);
      return Math.abs(next - to) > 0.002 ? next : to;
    };
    const before = [...c.rows, c.key, c.ambient, c.emergency, c.work].join();
    for (let r = 0; r < fixtureRows; r += 1) c.rows[r] = settle(c.rows[r] ?? 1, t.fixtureRow(r), 9);
    c.key = settle(c.key, t.key, 4);
    c.ambient = settle(c.ambient, t.ambient, 4);
    c.emergency = settle(c.emergency, t.emergency, 6);
    c.work = settle(c.work, t.work, 6);

    const f = preset.light.fixtures;
    setColors(lensesRef.current, hall.fixtures.length, (i, out) =>
      out.copy(WARM).multiplyScalar(f * 1.6 * c.rows[hall.fixtures[i]!.row]!),
    );
    setColors(poolsRef.current, hall.fixtures.length, (i, out) =>
      out.copy(WARM).multiplyScalar(0.022 * f * c.rows[hall.fixtures[i]!.row]!),
    );
    setColors(workRef.current, hall.workLights.length, (_, out) =>
      out.copy(WORK).multiplyScalar(1.8 * c.work),
    );
    setColors(washesRef.current, hall.workLights.length, (_, out) =>
      out.copy(WORK).multiplyScalar(0.11 * c.work),
    );
    setColors(emergencyRef.current, hall.emergency.length, (_, out) =>
      out.copy(EMERGENCY).multiplyScalar(0.12 + 2.2 * c.emergency),
    );
    const spin = t.beaconSpeed * (now / 1000);
    const beaconColor = t.beacon === "red" ? EMERGENCY : AMBER;
    const beaconLevel = (i: number) => {
      if (t.beacon === "off") return 0.05;
      if (t.beaconSpeed === 0) return 1.6;
      // A rotating reflector reads as a pulse from any one viewpoint.
      return 0.25 + 2.2 * Math.max(0, Math.cos((spin + i * 0.5) * Math.PI * 2)) ** 6;
    };
    setColors(beaconsRef.current, hall.beacons.length, (i, out) =>
      t.beacon === "off"
        ? out.setRGB(0.12, 0.1, 0.08)
        : out.copy(beaconColor).multiplyScalar(beaconLevel(i)),
    );
    const blinkOn = !t.indicatorsBlink || Math.floor(now / 500) % 2 === 0;
    setColors(indicatorsRef.current, hall.indicators.length, (_, out) =>
      out.copy(INDICATOR[t.indicators]).multiplyScalar(blinkOn ? 1.6 : 0.15),
    );

    let animating = before !== [...c.rows, c.key, c.ambient, c.emergency, c.work].join();
    const key = scene.getObjectByName(HALL_LIGHT_NAMES.key) as DirectionalLight | undefined;
    const fill = scene.getObjectByName(HALL_LIGHT_NAMES.fill) as DirectionalLight | undefined;
    const hemi = scene.getObjectByName(HALL_LIGHT_NAMES.hemisphere) as HemisphereLight | undefined;
    if (key) key.intensity = preset.light.key * c.key;
    if (fill) fill.intensity = preset.light.fill * c.key;
    if (hemi)
      hemi.intensity = preset.light.hemisphere * (0.45 + 0.55 * c.ambient * Math.max(c.key, 0.3));

    // Shock light: a brief flash at the failure site, sized by severity.
    const shock = shockRef.current;
    if (shock !== null) {
      const ph = phase.current;
      if (ph.flash > 0.001) {
        shock.position.copy(ph.flashAt);
        shock.intensity = 4000 * ph.flash * ph.flash;
        shock.distance = 20 + 60 * ph.flash;
        ph.flash *= Math.exp(-dt * (motionAllowed(settings) ? 7 : 12));
        animating = true;
      } else {
        shock.intensity = 0;
      }
    }
    if (animating || t.beacon !== "off" || t.indicatorsBlink) invalidate();
  });

  const byZone = (zone: Zone) =>
    hall.meshes
      .filter((m) => m.zone === zone)
      .map((m) => {
        // Only the crane casts a shadow from the hall itself: the walls sit outside the key
        // light's footprint, and under dozens of high-bay fixtures the roof trusses would not
        // stripe the floor. It also keeps the shadow map cheap to redraw.
        const heavy = m.surface === "crane";
        return (
          <mesh
            key={m.surface}
            geometry={m.geometry}
            material={materials[m.surface]}
            castShadow={heavy}
            receiveShadow={m.surface !== "glass" && m.surface !== "clerestory"}
            renderOrder={m.surface === "glass" ? 2 : 0}
          />
        );
      });

  return (
    <group name="main-reactor-hall">
      <mesh geometry={shared.floorGeometry} material={materials.floor} receiveShadow />
      <mesh geometry={shared.apron} material={materials.roof} />
      {byZone("floor")}
      {([...WALL_ZONES, "overhead"] as const).map((zone) => (
        <group
          key={zone}
          ref={(g) => {
            zones.current[zone] = g;
          }}
        >
          {byZone(zone)}
        </group>
      ))}
      <instancedMesh
        ref={lensesRef}
        args={[shared.lens, shared.lensMaterial, hall.fixtures.length]}
      />
      <instancedMesh
        visible={pools}
        ref={poolsRef}
        args={[shared.pool, shared.poolMaterial, hall.fixtures.length]}
        renderOrder={1}
      />
      <instancedMesh
        ref={workRef}
        args={[shared.lamp, shared.lampMaterial, hall.workLights.length]}
      />
      <instancedMesh
        visible={pools}
        ref={washesRef}
        args={[shared.wash, shared.poolMaterial, hall.workLights.length]}
        renderOrder={1}
      />
      <instancedMesh
        ref={emergencyRef}
        args={[shared.lamp, shared.lampMaterial, hall.emergency.length]}
      />
      <instancedMesh
        ref={beaconsRef}
        args={[shared.beacon, shared.lampMaterial, hall.beacons.length]}
      />
      <instancedMesh
        ref={indicatorsRef}
        args={[shared.indicator, shared.lampMaterial, hall.indicators.length]}
      />
      <pointLight ref={shockRef} intensity={0} distance={60} decay={1.8} color="#ffe2c0" />
    </group>
  );
}
