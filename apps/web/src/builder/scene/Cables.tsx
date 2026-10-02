import { plantSystemOfConnection } from "@forgelab/reactor-components";
import { sectionClipPlane } from "./inspection.js";
import { useLayoutEffect, useMemo } from "react";
import {
  type BufferGeometry,
  Color,
  CurvePath,
  CylinderGeometry,
  LineCurve3,
  Matrix4,
  Quaternion,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { localPointToWorld, type Vec3 } from "@forgelab/shared";
import {
  currentTransform,
  isLoadBearing,
  type ConnectionType,
  type SimulationComponent,
} from "@forgelab/sim-core";
import { useEditor } from "../store/context.js";
import { CONNECTION_COLORS } from "./appearance.js";
import { filleted, routePath, routeStyle, type RouteEnd } from "./routing.js";

/**
 * Service connections drawn as routed cables and pipes (see routing.ts): each system on
 * its own tray height, flanged where pipes meet ports, one merged mesh per system. The
 * Power and Coolant views tint their system so it reads at a glance.
 */
const LOOK: Partial<
  Record<ConnectionType, { color: string; metalness: number; roughness: number }>
> = {
  electrical: { color: "#202328", metalness: 0.1, roughness: 0.7 },
  control: { color: "#3a4048", metalness: 0.1, roughness: 0.6 },
  coolant: { color: "#3d6a92", metalness: 0.45, roughness: 0.45 },
  cryo: { color: "#d9dee3", metalness: 0.85, roughness: 0.22 },
  steam: { color: "#b8bfc6", metalness: 0.6, roughness: 0.4 },
  vacuum: { color: "#a8afb7", metalness: 0.85, roughness: 0.25 },
  fuel: { color: "#8a6d3b", metalness: 0.4, roughness: 0.5 },
  shaft: { color: "#7d858e", metalness: 0.85, roughness: 0.3 },
  port: { color: "#5d6773", metalness: 0.6, roughness: 0.4 },
};

const DEFAULT_LOOK = { color: "#8b96a4", metalness: 0.3, roughness: 0.6 };

const FLANGED = new Set<ConnectionType>(["coolant", "cryo", "steam", "vacuum", "fuel", "port"]);
const Y = new Vector3(0, 1, 0);

function worldEnd(component: SimulationComponent, socketId: string): RouteEnd | null {
  const socket = component.connectionPoints.find((p) => p.id === socketId);
  if (socket === undefined) return null;
  const t = currentTransform(component);
  const p: Vec3 = localPointToWorld(t, socket.localPosition);
  const q = new Quaternion(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
  const n = new Vector3(socket.localDirection.x, socket.localDirection.y, socket.localDirection.z)
    .applyQuaternion(q)
    .normalize();
  return { position: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] };
}

function tube(
  points: readonly (readonly [number, number, number])[],
  radius: number,
): BufferGeometry {
  const path = new CurvePath<Vector3>();
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    path.add(new LineCurve3(new Vector3(...a), new Vector3(...b)));
  }
  return new TubeGeometry(
    path,
    Math.max(8, points.length * 3),
    radius,
    radius > 0.2 ? 16 : 10,
    false,
  );
}

function flange(at: RouteEnd, radius: number): BufferGeometry {
  const g = new CylinderGeometry(radius * 1.45, radius * 1.45, Math.max(0.05, radius * 0.35), 18);
  const q = new Quaternion().setFromUnitVectors(Y, new Vector3(...at.normal));
  const offset = new Vector3(...at.normal).multiplyScalar(radius * 0.2);
  return g.applyMatrix4(
    new Matrix4().compose(new Vector3(...at.position).add(offset), q, new Vector3(1, 1, 1)),
  );
}

/** A cylindrical shell a run can pass through (a cryostat): axis vertical. */
interface Shell {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly yMin: number;
  readonly yMax: number;
}

/**
 * Where a run's path crosses a shell's wall: a penetration, drawn as a collar sleeve around
 * the run. Each one is a real service entering the machine, not decoration.
 */
export function penetrations(
  path: readonly (readonly [number, number, number])[],
  shells: readonly Shell[],
): RouteEnd[] {
  const out: RouteEnd[] = [];
  const inside = (p: readonly [number, number, number], s: Shell) =>
    Math.hypot(p[0] - s.x, p[2] - s.z) < s.r;
  for (const s of shells) {
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1]!;
      const b = path[i]!;
      if (inside(a, s) === inside(b, s)) continue;
      // Bisect for the crossing.
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 24; k += 1) {
        const m = (lo + hi) / 2;
        const p = [
          a[0] + (b[0] - a[0]) * m,
          a[1] + (b[1] - a[1]) * m,
          a[2] + (b[2] - a[2]) * m,
        ] as const;
        if (inside(p, s) === inside(a, s)) lo = m;
        else hi = m;
      }
      const t = (lo + hi) / 2;
      const p: [number, number, number] = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
      if (p[1] < s.yMin || p[1] > s.yMax) continue;
      const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      out.push({ position: p, normal: [d.x, d.y, d.z] });
    }
  }
  return out;
}

function sleeve(at: RouteEnd, radius: number): BufferGeometry {
  const g = new CylinderGeometry(radius * 1.7, radius * 1.7, Math.max(0.3, radius * 1.2), 20);
  const q = new Quaternion().setFromUnitVectors(Y, new Vector3(...at.normal));
  return g.applyMatrix4(
    new Matrix4().compose(new Vector3(...at.position), q, new Vector3(1, 1, 1)),
  );
}

export function Cables() {
  const connections = useEditor((v) => v.snapshot.connections);
  const components = useEditor((v) => v.snapshot.components);
  const hidden = useEditor((v) => v.hidden);
  const peeled = useEditor((v) => v.peeledIds);
  // Runs are drawn between where parts really are: an exploded drawing leaves them out.
  const exploded = useEditor((v) => v.explode > 0);
  const section = useEditor((v) => v.section);
  const clip = useMemo(() => (section === null ? null : [sectionClipPlane(section)]), [section]);
  const overlay = useEditor((v) => v.overlay);
  const xrayAll = useEditor((v) => v.xray);
  const focusSystem = useEditor((v) => v.focusSystem);

  const meshes = useMemo(() => {
    const byId = new Map(components.map((c) => [c.id, c]));
    const shells: Shell[] = components
      .filter((c) => c.type === "cryostat" && c.geometry.kind === "cylinder" && !peeled.has(c.id))
      .map((c) => {
        const g = c.geometry as Extract<typeof c.geometry, { kind: "cylinder" }>;
        const p = c.state.physical.positionM;
        return {
          x: p.x,
          z: p.z,
          r: g.radiusM,
          yMin: p.y - g.heightM / 2,
          yMax: p.y + g.heightM / 2,
        };
      });
    const parts = new Map<ConnectionType, BufferGeometry[]>();
    for (const connection of connections) {
      if (isLoadBearing(connection.type)) continue;
      const veiled = (id: string) => hidden.has(id) || peeled.has(id);
      if (veiled(connection.from.componentId) || veiled(connection.to.componentId)) continue;
      const a = byId.get(connection.from.componentId);
      const b = byId.get(connection.to.componentId);
      if (a === undefined || b === undefined) continue;
      const ea = worldEnd(a, connection.from.connectionPointId);
      const eb = worldEnd(b, connection.to.connectionPointId);
      if (ea === null || eb === null) continue;
      const portA = a.connectionPoints.find(
        (p) => p.id === connection.from.connectionPointId,
      )?.port;
      const portB = b.connectionPoints.find((p) => p.id === connection.to.connectionPointId)?.port;
      const style = routeStyle(connection.type, portA, portB);
      const path = filleted(routePath(ea, eb, style), Math.max(style.radiusM * 2.5, 0.3));
      if (path.length < 2) continue;
      const list = parts.get(connection.type) ?? [];
      list.push(tube(path, style.radiusM));
      if (FLANGED.has(connection.type))
        list.push(flange(ea, style.radiusM), flange(eb, style.radiusM));
      for (const at of penetrations(path, shells)) list.push(sleeve(at, style.radiusM));
      parts.set(connection.type, list);
    }
    return [...parts].map(([type, geometries]) => {
      const merged = mergeGeometries(geometries, false);
      for (const g of geometries) g.dispose();
      return { type, geometry: merged, look: LOOK[type] ?? DEFAULT_LOOK };
    });
  }, [connections, components, hidden, peeled]);

  useLayoutEffect(
    () => () => {
      for (const m of meshes) m.geometry?.dispose();
    },
    [meshes],
  );

  // Power, Coolant and Vacuum views light up their own system.
  const highlight: ConnectionType[] =
    overlay === "power"
      ? ["electrical"]
      : overlay === "coolant"
        ? ["coolant", "cryo", "steam"]
        : overlay === "vacuum"
          ? ["vacuum"]
          : [];
  if (exploded) return null;
  return (
    <group name="services">
      {meshes.map((m) => {
        // An isolated system keeps its own runs solid; X-ray and isolation ghost the rest.
        const inFocus = focusSystem !== null && plantSystemOfConnection(m.type) === focusSystem;
        const xray = (xrayAll && !inFocus) || (focusSystem !== null && !inFocus);
        return m.geometry === null ? null : (
          <mesh
            key={m.type}
            geometry={m.geometry}
            castShadow
            receiveShadow
            renderOrder={xray ? 3 : 0}
          >
            <meshStandardMaterial
              // Remount when transparency flips: three only recompiles a material's
              // shader on needsUpdate, which a changed prop does not set.
              key={xray ? "ghost" : "solid"}
              attach="material"
              color={m.look.color}
              metalness={m.look.metalness}
              roughness={m.look.roughness}
              emissive={
                highlight.includes(m.type)
                  ? new Color(CONNECTION_COLORS[m.type] ?? "#ffffff")
                  : new Color(0)
              }
              emissiveIntensity={highlight.includes(m.type) ? 0.9 : 0}
              transparent={xray}
              opacity={xray ? (focusSystem !== null ? 0.08 : 0.3) : 1}
              depthWrite={!xray}
              clippingPlanes={clip}
            />
          </mesh>
        );
      })}
    </group>
  );
}
