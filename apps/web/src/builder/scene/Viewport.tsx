import {
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  TransformControls,
} from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  BackSide,
  Color,
  type InstancedMesh,
  type Group,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  Plane,
  Quaternion as ThreeQuaternion,
  Raycaster,
  type ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type OrthographicCamera as ThreeOrthographicCamera,
  type PerspectiveCamera as ThreePerspectiveCamera,
} from "three";
import { localPointToWorld, vec3, type Vec3 } from "@forgelab/shared";
import {
  checkPortCompatibility,
  currentTransform,
  worldAabb,
  type ConnectionPoint,
  type SimulationComponent,
  geometryLocalHalfExtentsM,
} from "@forgelab/sim-core";
import { prefersReducedMotion } from "../../lib/platform.js";
import {
  applyAutomaticQuality,
  motionAllowed,
  tierBudget,
  useSettings,
} from "../../presentation/settings.js";
import { useCinematic } from "../../presentation/view.js";
import { AudioBridge } from "../../presentation/audio/AudioBridge.js";
import { CinemaDriver } from "../../presentation/CinemaDriver.js";
import { PostFx } from "../../presentation/PostFx.js";
import { ScreenCracks } from "../../presentation/vfx/ScreenCracks.js";
import { VfxLayer } from "../../presentation/vfx/VfxLayer.js";
import { portRating } from "../ui/Inspector.js";
import { Cables } from "./Cables.js";
import { damageStage, stageDarkening } from "../../presentation/damage.js";
import { damageState } from "../../presentation/damageState.js";
import { FieldLines } from "./FieldLines.js";
import { ScaleFigure } from "./ScaleFigure.js";
import { PresenceOrbs } from "./PresenceOrbs.js";
import { WalkControls } from "./WalkControls.js";
import { aimBreach, breachedIds, breachPlanes } from "./fracture.js";
import { aimCutPlane, cutPlaneFor } from "./cutPlanes.js";
import { cachedExplodeOffsets, cutViewOf, sectionClipPlane } from "./inspection.js";
import { familyColor } from "./materialView.js";
import { trimVisibleAt } from "./lod.js";
import { InternalsSection, showsInternals } from "./Internals.js";
import { ComponentAnimator } from "./ComponentAnimator.js";
import { applyPlasmaState } from "./plasma.js";
import { useEditor, useEditorStore } from "../store/context.js";
import type { EditorStore, ViewName } from "../store/editor.js";
import {
  CONNECTION_COLORS,
  PALETTE,
  appearanceFor,
  surfaceMaterial,
  ghostedIn,
  materialColor,
  readoutFromComponent,
  readoutFromFrame,
} from "./appearance.js";
import { hover } from "./hover.js";
import { Environment } from "./environment/Environment.js";
import { DEFAULT_CAMERA } from "./environment/hall/cameras.js";
import { ComponentMesh, isDragging, meshRegistry, setDragging } from "./meshes.js";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

/* ------------------------------------------------------------------------------------ *
 * Parts
 * ------------------------------------------------------------------------------------ */

function Parts() {
  const store = useEditorStore();
  const components = useEditor((v) => v.snapshot.components);
  const selection = useEditor((v) => v.selection);
  const hidden = useEditor((v) => v.hidden);
  const peeled = useEditor((v) => v.peeledIds);
  const selected = useMemo(() => new Set(selection), [selection]);
  const onPick = useCallback(
    (id: string, event: ThreeEvent<MouseEvent>) => {
      if (store.getView().tool === "connect") return;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      store.select([id], additive ? "toggle" : "replace");
    },
    [store],
  );
  const onHover = useCallback(
    (id: string | null) => hover.set(id === null ? null : { componentId: id }),
    [],
  );
  return (
    <>
      {components.map((c) => (
        <ComponentMesh
          key={c.id}
          component={c}
          selected={selected.has(c.id)}
          visible={!hidden.has(c.id) && !peeled.has(c.id)}
          onPick={onPick}
          onHover={onHover}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------------------------ *
 * Appearance: overlays, selection, x-ray, cutaway, live transforms
 * ------------------------------------------------------------------------------------ */

const materialColors = new Map<string, Color>();
function baseColor(materialId: string): Color {
  let color = materialColors.get(materialId);
  if (color === undefined) {
    color = materialColor(materialId);
    materialColors.set(materialId, color);
  }
  return color;
}

function AppearanceDriver() {
  const store = useEditorStore();
  const invalidate = useThree((s) => s.invalidate);
  const dirty = useRef(true);
  const lastFrame = useRef<unknown>(null);

  useEffect(() => {
    const mark = () => {
      dirty.current = true;
      invalidate();
    };
    const a = store.subscribe(mark);
    const b = store.subscribeSim(mark);
    const c = hover.subscribe(mark);
    const d = damageState.subscribe(mark);
    return () => {
      a();
      b();
      c();
      d();
    };
  }, [store, invalidate]);

  useFrame(() => {
    const frame = store.frame;
    if (!dirty.current && frame === lastFrame.current) return;
    dirty.current = false;
    lastFrame.current = frame;
    const view = store.getView();
    const live = view.mode === "simulate" && frame !== null;
    const selected = new Set(view.selection);
    const hovered = hover.get()?.componentId;
    const failureTypes = new Map<string, string[]>();
    for (const f of store.getSim().failures) {
      const list = failureTypes.get(f.componentId) ?? [];
      list.push(f.failureType);
      failureTypes.set(f.componentId, list);
    }
    for (const c of view.snapshot.components) {
      const handle = meshRegistry.get(c.id);
      if (handle === undefined) continue;
      const index = live ? store.frameIndexOf(c.id) : undefined;
      const readout =
        live && index !== undefined ? readoutFromFrame(frame, index, c) : readoutFromComponent(c);
      if (!isDragging(c.id)) {
        if (live && index !== undefined) {
          const t = frame.transforms;
          const o = index * 7;
          handle.group.position.set(t[o]!, t[o + 1]!, t[o + 2]!);
          handle.group.quaternion.set(t[o + 3]!, t[o + 4]!, t[o + 5]!, t[o + 6]!);
        } else {
          const { positionM: p, rotation: q } = c.state.physical;
          // The exploded view moves the drawing, never the design.
          const o =
            view.explode > 0 ? cachedExplodeOffsets(view.snapshot.components).get(c.id) : undefined;
          const k = view.explode;
          handle.group.position.set(
            p.x + (o?.x ?? 0) * k,
            p.y + (o?.y ?? 0) * k,
            p.z + (o?.z ?? 0) * k,
          );
          handle.group.quaternion.set(q.x, q.y, q.z, q.w);
        }
      }
      const body = handle.body;
      let emissive = appearanceFor(
        view.overlay,
        readout,
        view.overlay === "materials" ? familyColor(c.materialId) : baseColor(c.materialId),
        body,
        surfaceMaterial(c.materialId),
      );
      // Damage shows in the Normal view: surfaces darken and dull as the part degrades.
      if (live && view.overlay === "none") {
        const stage = damageStage({
          utilization: readout.utilization,
          temperatureK: readout.temperatureK,
          limitTemperatureK: readout.limitTemperatureK,
          hoopUtilization: readout.hoopUtilization,
          headFraction: readout.headFraction,
          disabled: readout.disabled,
          failureTypes: failureTypes.get(c.id) ?? [],
          fractured: damageState.isFractured(c.id),
        }).stage;
        const k = stageDarkening(stage);
        if (k > 0) body.color.multiplyScalar(1 - k);
      }
      if (selected.has(c.id)) {
        body.emissive.lerp(PALETTE.select, emissive > 0.3 ? 0.3 : 1);
        emissive = Math.max(emissive, 0.2);
      } else if (hovered === c.id) {
        body.emissive.lerp(PALETTE.select, 0.6);
        emissive = Math.max(emissive, 0.14);
      }
      body.emissiveIntensity = emissive;
      // An isolated plant system stays solid and everything else ghosts; with X-ray on as
      // well, the isolated system is what you see through the rest.
      const focused = view.focusIds?.has(c.id) ?? false;
      const ghost =
        (view.focusIds !== null && !focused) ||
        (view.materialFocusIds !== null && !view.materialFocusIds.has(c.id));
      const xray =
        (view.xray && !focused) ||
        ghost ||
        ghostedIn(view.overlay, readout) ||
        // The picked material is inside this machine: see through its casing to it.
        (view.materialFocus !== null &&
          focusedMaterial(view, c) &&
          c.materialId !== view.materialFocus) ||
        (view.overlay === "internals" && showsInternals(c.type));
      if (body.transparent !== xray) {
        body.transparent = xray;
        body.depthWrite = !xray;
        body.needsUpdate = true;
      }
      body.opacity = xray ? (ghost ? 0.07 : 0.16) : 1;
      // The cutaway plane, else the breach of a part that broke up this run (fracture.ts).
      const breach = live ? breachPlanes(c.id) : null;
      const cut = cutViewOf(view) !== "none";
      const planes = cut ? [cutPlaneFor(c.id)] : breach;
      const intersect = !cut && breach !== null;
      if (
        (body.clippingPlanes?.length ?? 0) !== (planes?.length ?? 0) ||
        body.clipIntersection !== intersect
      ) {
        body.clippingPlanes = planes;
        body.clipIntersection = intersect;
        body.needsUpdate = true;
      }
      for (const extra of handle.extras) {
        if (
          extra.transparent !== xray ||
          (extra.clippingPlanes?.length ?? 0) !== (planes?.length ?? 0) ||
          extra.clipIntersection !== intersect
        ) {
          extra.transparent = xray;
          extra.depthWrite = !xray;
          extra.clippingPlanes = planes;
          extra.clipIntersection = intersect;
          extra.needsUpdate = true;
        }
        extra.opacity = xray ? (ghost ? 0.05 : 0.12) : 1;
      }
      if (handle.glow !== null) {
        const brightness = applyPlasmaState(handle.glow.material as ShaderMaterial, readout.vessel);
        handle.glow.visible = brightness > 0;
      }
    }
  });
  return null;
}

const sizeCache = new WeakMap<readonly SimulationComponent[], ReadonlyMap<string, number>>();

/** Each part's bounding radius, computed once per design snapshot. */
function partSizes(components: readonly SimulationComponent[]): ReadonlyMap<string, number> {
  let sizes = sizeCache.get(components);
  if (sizes === undefined) {
    sizes = new Map(
      components.map((c) => {
        const h = geometryLocalHalfExtentsM(c.geometry);
        return [c.id, Math.hypot(h.x, h.y, h.z)] as const;
      }),
    );
    sizeCache.set(components, sizes);
  }
  return sizes;
}

/** Shows or hides each part's fine fittings by camera distance (lod.ts). */
function LodDriver() {
  const store = useEditorStore();
  const world = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    const sizes = partSizes(store.getView().snapshot.components);
    for (const [id, handle] of meshRegistry) {
      const trim = handle.extras[0];
      if (trim === undefined) continue;
      handle.group.getWorldPosition(world);
      const show = trimVisibleAt(camera.position.distanceTo(world), sizes.get(id) ?? 1);
      if (trim.visible !== show) trim.visible = show;
    }
  });
  return null;
}

/**
 * Re-aims each part's cutaway plane at the camera on every rendered frame, and moves the
 * breach of each broken part with it.
 */
function CutPlaneDriver() {
  const store = useEditorStore();
  const centre = useMemo(() => new Vector3(), []);
  const orientation = useMemo(() => new ThreeQuaternion(), []);
  const section = useMemo(() => new Plane(), []);
  useFrame(({ camera }) => {
    // Breaches follow their parts wherever they are.
    for (const id of breachedIds()) {
      const handle = meshRegistry.get(id);
      if (handle === undefined) continue;
      handle.group.updateWorldMatrix(true, false);
      aimBreach(id, handle.group.matrixWorld);
    }
    const view = store.getView();
    // One plane through the whole plant: every part is cut by the same plane.
    if (view.section !== null) {
      sectionClipPlane(view.section, section);
      for (const id of meshRegistry.keys()) cutPlaneFor(id).copy(section);
      return;
    }
    if (cutViewOf(view) === "none" && view.overlay !== "internals") return;
    for (const [id, handle] of meshRegistry) {
      handle.group.getWorldPosition(centre);
      handle.group.getWorldQuaternion(orientation);
      aimCutPlane(id, centre, orientation, camera);
    }
  });
  return null;
}

/* ------------------------------------------------------------------------------------ *
 * Sockets (connect tool and selected parts)
 * ------------------------------------------------------------------------------------ */

interface SocketEntry {
  readonly componentId: string;
  readonly socketId: string;
  readonly type: string;
  readonly position: Vec3;
  readonly radius: number;
  readonly point: ConnectionPoint;
}

/** While connecting: can this port take the one already picked? */
type Fit = "picked" | "ok" | "warn" | "no" | "idle";

/**
 * While connecting, each port keeps its domain colour (so green never reads as a domain)
 * and wears a halo for sim-core's verdict: green compatible, amber warning, red
 * incompatible (the port itself dims), white for the port picked first.
 */
const FIT_LOOK: Readonly<
  Record<Exclude<Fit, "idle">, { halo: string; scale: number; dim: number }>
> = {
  picked: { halo: "#ffffff", scale: 1.6, dim: 1 },
  ok: { halo: "#5eeaa0", scale: 1.35, dim: 1 },
  warn: { halo: "#ffb020", scale: 1.25, dim: 1 },
  no: { halo: "#e5484d", scale: 0.7, dim: 0.3 },
};

function Sockets() {
  const store = useEditorStore();
  const mode = useEditor((v) => v.mode);
  const tool = useEditor((v) => v.tool);
  const selection = useEditor((v) => v.selection);
  const components = useEditor((v) => v.snapshot.components);
  const hidden = useEditor((v) => v.hidden);
  const connectFrom = useEditor((v) => v.connectFrom);
  const ref = useRef<InstancedMesh>(null);
  const haloRef = useRef<InstancedMesh>(null);

  const entries = useMemo<SocketEntry[]>(() => {
    if (mode !== "build") return [];
    const show =
      tool === "connect"
        ? components.filter((c) => !hidden.has(c.id))
        : components.filter((c) => selection.includes(c.id));
    const out: SocketEntry[] = [];
    for (const c of show) {
      const box = worldAabb(c.geometry, c.transform);
      const size = Math.max(
        box.maxM.x - box.minM.x,
        box.maxM.y - box.minM.y,
        box.maxM.z - box.minM.z,
      );
      const radius = Math.min(0.6, Math.max(0.12, size * 0.02));
      for (const p of c.connectionPoints) {
        out.push({
          componentId: c.id,
          socketId: p.id,
          type: p.connectionType,
          position: localPointToWorld(c.transform, p.localPosition),
          radius,
          point: p,
        });
      }
    }
    return out;
  }, [mode, tool, selection, components, hidden]);

  const sphere = useMemo(() => new SphereGeometry(1, 12, 8), []);
  const material = useMemo(
    () => new MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.95 }),
    [],
  );
  const haloMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.42,
        side: BackSide,
      }),
    [],
  );
  useEffect(() => () => sphere.dispose(), [sphere]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => haloMaterial.dispose(), [haloMaterial]);

  useEffect(() => {
    const mesh = ref.current;
    const halo = haloRef.current;
    if (mesh === null || halo === null) return;
    const m = new Matrix4();
    const color = new Color();
    const from =
      connectFrom === null
        ? null
        : (components
            .find((c) => c.id === connectFrom.componentId)
            ?.connectionPoints.find((p) => p.id === connectFrom.connectionPointId) ?? null);
    entries.forEach((e, i) => {
      let fit: Fit = "idle";
      if (connectFrom !== null && from !== null) {
        if (
          connectFrom.componentId === e.componentId &&
          connectFrom.connectionPointId === e.socketId
        )
          fit = "picked";
        else if (connectFrom.componentId === e.componentId) fit = "no";
        else {
          // sim-core decides; the scene only shows its three states.
          const state = checkPortCompatibility(from, e.point).state;
          fit = state === "incompatible" ? "no" : state === "warning" ? "warn" : "ok";
        }
      }
      const look = fit === "idle" ? null : FIT_LOOK[fit];
      const r = e.radius * (look !== null && fit === "no" ? look.scale : 1);
      m.makeScale(r, r, r).setPosition(e.position.x, e.position.y, e.position.z);
      mesh.setMatrixAt(i, m);
      color.set(CONNECTION_COLORS[e.type] ?? "#8b96a4").multiplyScalar(look?.dim ?? 1);
      mesh.setColorAt(i, color);
      const h = look === null ? 0 : e.radius * (fit === "no" ? 1.2 : 1.9) * look.scale;
      m.makeScale(h, h, h).setPosition(e.position.x, e.position.y, e.position.z);
      halo.setMatrixAt(i, m);
      color.set(look?.halo ?? "#000000");
      halo.setColorAt(i, color);
    });
    for (const target of [mesh, halo]) {
      target.count = entries.length;
      target.instanceMatrix.needsUpdate = true;
      if (target.instanceColor) target.instanceColor.needsUpdate = true;
      target.computeBoundingSphere();
    }
  }, [entries, connectFrom, components]);

  if (entries.length === 0) return null;
  const capacity = Math.max(entries.length, entries.length > 512 ? 4096 : 512);
  return (
    <>
      <instancedMesh
        key={`halo-${entries.length > 512 ? "large" : "small"}`}
        ref={haloRef}
        args={[sphere, haloMaterial, capacity]}
        renderOrder={9}
        raycast={() => null}
      />
      <instancedMesh
        key={entries.length > 512 ? "large" : "small"}
        ref={ref}
        args={[sphere, material, capacity]}
        renderOrder={10}
        onClick={(event) => {
          if (event.delta > 4 || event.instanceId === undefined) return;
          event.stopPropagation();
          const e = entries[event.instanceId];
          if (e === undefined) return;
          if (store.getView().tool !== "connect") store.setTool("connect");
          store.pickSocket({ componentId: e.componentId, connectionPointId: e.socketId });
        }}
        onPointerMove={(event) => {
          if (event.instanceId === undefined) return;
          const e = entries[event.instanceId];
          if (e === undefined) return;
          const port = e.point.port;
          hover.set({
            componentId: e.componentId,
            socket: {
              id: e.socketId,
              type: e.type,
              ...(port !== undefined ? { label: port.label, rating: portRating(port) } : {}),
            },
          });
        }}
        onPointerOut={() => hover.set(null)}
      />
    </>
  );
}

/* ------------------------------------------------------------------------------------ *
 * Gizmo: move and rotate the selection as a group
 * ------------------------------------------------------------------------------------ */

function useAltKey(): boolean {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => setAlt(e.altKey);
    const off = () => setAlt(false);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return alt;
}

function Gizmo() {
  const store = useEditorStore();
  const mode = useEditor((v) => v.mode);
  const tool = useEditor((v) => v.tool);
  const selection = useEditor((v) => v.selection);
  const components = useEditor((v) => v.snapshot.components);
  const snapEnabled = useEditor((v) => v.snapEnabled);
  const gridM = useEditor((v) => v.gridM);
  const angleSnapDeg = useEditor((v) => v.angleSnapDeg);
  const alt = useAltKey();
  const pivot = useRef<Group>(null);
  const start = useRef<{
    pivotPos: Vector3;
    pivotQuat: ThreeQuaternion;
    items: { id: string; pos: Vector3; quat: ThreeQuaternion }[];
  } | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const primary = selection[selection.length - 1];
  const primaryComponent = components.find((c) => c.id === primary);
  const exploded = useEditor((v) => v.explode > 0);
  const show =
    mode === "build" &&
    !exploded &&
    (tool === "select" || tool === "move" || tool === "rotate") &&
    primaryComponent !== undefined;

  useEffect(() => {
    const p = pivot.current;
    if (p === null || primaryComponent === undefined || start.current !== null) return;
    const { positionM } = primaryComponent.transform;
    p.position.set(positionM.x, positionM.y, positionM.z);
    p.quaternion.set(0, 0, 0, 1);
    invalidate();
  }, [primaryComponent, invalidate, show]);

  const snapOff = !snapEnabled || alt;
  return (
    <>
      <group ref={pivot} />
      {show && (
        <TransformControls
          object={pivot as unknown as MutableRefObject<Object3D>}
          mode={tool === "rotate" ? "rotate" : "translate"}
          space="world"
          size={0.9}
          translationSnap={snapOff ? null : gridM}
          rotationSnap={snapOff ? null : (angleSnapDeg * Math.PI) / 180}
          onMouseDown={() => {
            const p = pivot.current;
            if (p === null) return;
            start.current = {
              pivotPos: p.position.clone(),
              pivotQuat: p.quaternion.clone(),
              items: selection.flatMap((id) => {
                const h = meshRegistry.get(id);
                return h
                  ? [{ id, pos: h.group.position.clone(), quat: h.group.quaternion.clone() }]
                  : [];
              }),
            };
            setDragging(selection);
          }}
          onObjectChange={() => {
            const s = start.current;
            const p = pivot.current;
            if (s === null || p === null) return;
            const dq = p.quaternion.clone().multiply(s.pivotQuat.clone().invert());
            const delta = p.position.clone().sub(s.pivotPos);
            for (const item of s.items) {
              const h = meshRegistry.get(item.id);
              if (!h) continue;
              const offset = item.pos.clone().sub(s.pivotPos).applyQuaternion(dq);
              h.group.position.copy(s.pivotPos).add(offset).add(delta);
              h.group.quaternion.copy(dq).multiply(item.quat);
            }
          }}
          onMouseUp={() => {
            const s = start.current;
            start.current = null;
            setDragging([]);
            if (s === null) return;
            const updates = s.items.flatMap((item) => {
              const h = meshRegistry.get(item.id);
              if (!h) return [];
              const moved =
                !h.group.position.equals(item.pos) || !h.group.quaternion.equals(item.quat);
              if (!moved) return [];
              const q = h.group.quaternion;
              return [
                {
                  id: item.id,
                  position: vec3(h.group.position.x, h.group.position.y, h.group.position.z),
                  rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
                },
              ];
            });
            if (updates.length > 0) store.moveComponents(updates, alt);
            invalidate();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------------------------ */

interface CameraMemory {
  position: Vector3;
  target: Vector3;
}
const cameraMemory: CameraMemory = {
  position: new Vector3(...DEFAULT_CAMERA.position),
  target: new Vector3(...DEFAULT_CAMERA.target),
};

const VIEW_DIRECTIONS: Record<ViewName, Vector3> = {
  front: new Vector3(0, 0.0001, 1),
  right: new Vector3(1, 0.0001, 0),
  top: new Vector3(0, 1, 0.0001),
  iso: new Vector3(1, 0.75, 1).normalize(),
};

function boundsOf(
  components: readonly SimulationComponent[],
): { centre: Vector3; radius: number } | null {
  if (components.length === 0) return null;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const c of components) {
    const box = worldAabb(c.geometry, currentTransform(c));
    min.min(new Vector3(box.minM.x, box.minM.y, box.minM.z));
    max.max(new Vector3(box.maxM.x, box.maxM.y, box.maxM.z));
  }
  const centre = min.clone().add(max).multiplyScalar(0.5);
  return { centre, radius: Math.max(1.5, max.distanceTo(min) / 2) };
}

function CameraRig({ controlsRef }: { controlsRef: MutableRefObject<OrbitControlsImpl | null> }) {
  const store = useEditorStore();
  const cinematic = useCinematic();
  const projection = useEditor((v) => v.projection);
  const cameraMode = useEditor((v) => v.cameraMode);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef<{
    fromPos: Vector3;
    toPos: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    fromZoom: number;
    toZoom: number;
    t0: number;
    ms: number;
  } | null>(null);

  useEffect(() => {
    return store.subscribeCamera(() => {
      const request = store.cameraRequest;
      const controls = controlsRef.current;
      if (request === null || controls === null) return;
      // Walking and flying put the camera where the player takes it; framing would yank it.
      if (store.getView().cameraMode !== "orbit") return;
      const view = store.getView();
      const target = controls.target.clone();
      if (request.kind === "pose") {
        anim.current = {
          fromPos: camera.position.clone(),
          toPos: new Vector3(...request.position),
          fromTarget: target,
          toTarget: new Vector3(...request.target),
          fromZoom: camera.zoom,
          toZoom: camera.zoom,
          t0: performance.now(),
          ms: prefersReducedMotion() ? 0 : 700,
        };
        invalidate();
        return;
      }
      let direction = camera.position.clone().sub(target).normalize();
      let bounds: { centre: Vector3; radius: number } | null;
      if (request.kind === "frame") {
        const pool = view.snapshot.components.filter((c) =>
          request.ids === null
            ? !view.hidden.has(c.id) && !view.peeledIds.has(c.id)
            : request.ids.includes(c.id),
        );
        bounds = boundsOf(pool);
      } else {
        direction = VIEW_DIRECTIONS[request.view].clone();
        bounds = boundsOf(
          view.snapshot.components.filter(
            (c) => !view.hidden.has(c.id) && !view.peeledIds.has(c.id),
          ),
        ) ?? {
          centre: target,
          radius: target.distanceTo(camera.position) / 2.4,
        };
      }
      const centre = bounds?.centre ?? new Vector3(0, 2, 0);
      const radius = bounds?.radius ?? 16;
      const fov = ((camera as ThreePerspectiveCamera).fov ?? 45) * (Math.PI / 180);
      const distance = Math.min(2500, Math.max(10, (radius / Math.sin(fov / 2)) * 1.3));
      const toZoom = (camera as ThreeOrthographicCamera).isOrthographicCamera
        ? size.height / (2 * radius * 1.2)
        : camera.zoom;
      anim.current = {
        fromPos: camera.position.clone(),
        toPos: centre.clone().add(direction.multiplyScalar(distance)),
        fromTarget: target,
        toTarget: centre,
        fromZoom: camera.zoom,
        toZoom,
        t0: performance.now(),
        ms: prefersReducedMotion() ? 0 : 420,
      };
      invalidate();
    });
  }, [store, camera, size.height, controlsRef, invalidate]);

  useFrame((state) => {
    const camera = state.camera;
    const controls = controlsRef.current;
    // Cinematic drift: OrbitControls turns the camera only on rendered frames.
    if (cinematic && motionAllowed()) {
      controls?.update();
      invalidate();
    }
    if (cameraMode !== "orbit") anim.current = null;
    const a = anim.current;
    if (controls !== null && a !== null) {
      const t = a.ms === 0 ? 1 : Math.min(1, (performance.now() - a.t0) / a.ms);
      const e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(a.fromPos, a.toPos, e);
      controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
      camera.zoom = a.fromZoom + (a.toZoom - a.fromZoom) * e;
      camera.updateProjectionMatrix();
      controls.update();
      if (t >= 1) anim.current = null;
      invalidate();
    }
    if (controls !== null) {
      cameraMemory.position.copy(camera.position);
      cameraMemory.target.copy(controls.target);
    }
    // Near plane follows the viewing distance: centimetres when inspecting a flange,
    // a metre when the whole hall is in view, so depth stays precise at every scale.
    const perspective = camera as ThreePerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      const d =
        cameraMode === "orbit" && controls !== null
          ? camera.position.distanceTo(controls.target)
          : 5;
      const near = Math.min(1, Math.max(0.02, d * 0.002));
      if (Math.abs(near - perspective.near) > perspective.near * 0.2) {
        perspective.near = near;
        perspective.updateProjectionMatrix();
      }
    }
  });

  const distance = cameraMemory.position.distanceTo(cameraMemory.target);
  const orthoZoom = size.height / (2 * distance * Math.tan((45 * Math.PI) / 360));
  return (
    <>
      {projection === "perspective" ? (
        <PerspectiveCamera
          makeDefault
          fov={45}
          near={0.1}
          far={8000}
          position={cameraMemory.position.toArray()}
        />
      ) : (
        <OrthographicCamera
          makeDefault
          near={-8000}
          far={8000}
          zoom={orthoZoom}
          position={cameraMemory.position.toArray()}
        />
      )}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={cameraMode === "orbit"}
        target={cameraMemory.target.toArray()}
        enableDamping
        dampingFactor={0.14}
        screenSpacePanning
        minDistance={0.5}
        maxDistance={4000}
        maxPolarAngle={Math.PI * 0.499}
        autoRotate={cinematic && motionAllowed()}
        autoRotateSpeed={0.25}
      />
      <WalkControls mode={cameraMode} />
    </>
  );
}

/* ------------------------------------------------------------------------------------ *
 * Store bridge: placement rays, projection, thumbnails
 * ------------------------------------------------------------------------------------ */

function ViewportBridge({
  store,
  controlsRef,
}: {
  store: EditorStore;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
}) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    store.setViewport({
      groundPointAt(clientX, clientY) {
        const { camera, gl } = get();
        const rect = gl.domElement.getBoundingClientRect();
        ndc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(ndc, camera);
        const plane = new Plane(new Vector3(0, 1, 0), -store.world.settings.groundLevelM);
        const hit = raycaster.ray.intersectPlane(plane, new Vector3());
        return hit === null ? null : vec3(hit.x, hit.y, hit.z);
      },
      focusPoint() {
        const t = controlsRef.current?.target ?? cameraMemory.target;
        return vec3(t.x, 0, t.z);
      },
      project(points) {
        const { camera, gl } = get();
        const rect = gl.domElement.getBoundingClientRect();
        const v = new Vector3();
        return points.map((p) => {
          v.set(p.x, p.y, p.z).project(camera);
          if (v.z > 1 || v.z < -1) return null;
          return {
            x: rect.left + ((v.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - v.y) / 2) * rect.height,
          };
        });
      },
      capture() {
        // Thumbnails are at most 900 px wide: render once at that resolution, snapshot the
        // canvas, then restore the viewer's pixel ratio.
        const { gl, scene, camera, size, invalidate } = get();
        const ratio = gl.getPixelRatio();
        gl.setPixelRatio(Math.min(ratio, 900 / Math.max(1, size.width)));
        gl.render(scene, camera);
        return new Promise((resolve) => {
          gl.domElement.toBlob(resolve, "image/png");
          gl.setPixelRatio(ratio);
          invalidate();
        });
      },
    });
    // Browser tests (`/app?debug`) profile and inspect the scene through this.
    const debug = (window as unknown as { __forgelab?: Record<string, unknown> }).__forgelab;
    if (debug !== undefined) debug["three"] = get;
    return () => store.setViewport(null);
  }, [store, get, controlsRef]);
  return null;
}

function InvalidateOnStore() {
  const store = useEditorStore();
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  useEffect(() => {
    // Shadows are redrawn only when something that casts them can have moved: an edit or a
    // simulation frame. Lighting animation alone reuses the last shadow map.
    const shadows = get().gl.shadowMap;
    shadows.autoUpdate = false;
    shadows.needsUpdate = true;
    const refresh = () => {
      shadows.needsUpdate = true;
      invalidate();
    };
    const a = store.subscribe(refresh);
    const b = store.subscribeSim(refresh);
    return () => {
      a();
      b();
      shadows.autoUpdate = true;
    };
  }, [store, invalidate, get]);
  return null;
}

/* ------------------------------------------------------------------------------------ *
 * Viewport
 * ------------------------------------------------------------------------------------ */

interface BoxState {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
}

export function Viewport() {
  const store = useEditorStore();
  const cinematic = useCinematic();
  const tool = useEditor((v) => v.tool);
  const cutaway = useEditor((v) => v.cutaway);
  const mode = useEditor((v) => v.mode);
  const empty = useEditor((v) => v.snapshot.components.length === 0);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [box, setBox] = useState<BoxState | null>(null);
  const boxRef = useRef<BoxState | null>(null);
  const suppressMiss = useRef(false);
  const [contextLost, setContextLost] = useState(false);
  const pixelRatio = tierBudget(useSettings()).pixelRatio;

  const finishBox = (state: BoxState) => {
    const left = Math.min(state.x0, state.x1);
    const right = Math.max(state.x0, state.x1);
    const top = Math.min(state.y0, state.y1);
    const bottom = Math.max(state.y0, state.y1);
    const view = store.getView();
    const candidates = view.snapshot.components.filter((c) => !view.hidden.has(c.id));
    const points = candidates.map((c) => c.state.physical.positionM);
    const screen = store.viewport?.project(points) ?? [];
    const ids = candidates
      .filter((_, i) => {
        const s = screen[i];
        return (
          s !== null &&
          s !== undefined &&
          s.x >= left &&
          s.x <= right &&
          s.y >= top &&
          s.y <= bottom
        );
      })
      .map((c) => c.id);
    store.select(ids, state.additive ? "add" : "replace");
  };

  return (
    <div
      className={`viewport${tool === "box" ? " viewport--box" : ""}${tool === "connect" ? " viewport--connect" : ""}`}
      onPointerDownCapture={(event) => {
        if (event.button !== 0 || !(tool === "box" || event.shiftKey)) return;
        if ((event.target as HTMLElement).tagName !== "CANVAS") return;
        const state = {
          x0: event.clientX,
          y0: event.clientY,
          x1: event.clientX,
          y1: event.clientY,
          additive: event.shiftKey,
        };
        boxRef.current = state;
        if (controlsRef.current) controlsRef.current.enabled = false;
      }}
      onPointerMove={(event) => {
        const state = boxRef.current;
        if (state === null) return;
        state.x1 = event.clientX;
        state.y1 = event.clientY;
        if (Math.abs(state.x1 - state.x0) + Math.abs(state.y1 - state.y0) > 6) setBox({ ...state });
      }}
      onPointerUp={() => {
        const state = boxRef.current;
        boxRef.current = null;
        if (controlsRef.current) controlsRef.current.enabled = true;
        if (state !== null && Math.abs(state.x1 - state.x0) + Math.abs(state.y1 - state.y0) > 6) {
          finishBox(state);
          suppressMiss.current = true;
        }
        setBox(null);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-forgelab-part")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const type = event.dataTransfer.getData("application/x-forgelab-part");
        if (type === "") return;
        event.preventDefault();
        const at = store.viewport?.groundPointAt(event.clientX, event.clientY) ?? undefined;
        store.addPart(type, at);
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, pixelRatio]}
        shadows="percentage"
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          const context = gl.getContext();
          const info = context.getExtension("WEBGL_debug_renderer_info");
          applyAutomaticQuality(
            info === null ? "" : String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)),
          );
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            setContextLost(true);
          });
          gl.domElement.addEventListener("webglcontextrestored", () => setContextLost(false));
        }}
        onPointerMissed={(event) => {
          if (suppressMiss.current) {
            suppressMiss.current = false;
            return;
          }
          if (event.button === 0 && !event.shiftKey) store.dismissPanels();
        }}
        aria-label="3D workspace"
      >
        <Environment showGrid={mode === "build"} />
        <CameraRig controlsRef={controlsRef} />
        <Parts />
        <Cables />
        <CutPlaneDriver />
        <InternalsSection />
        <FieldLines />
        <ScaleFigure />
        <PresenceOrbs />
        <LodDriver />
        <Sockets />
        <Gizmo />
        <AppearanceDriver />
        <ComponentAnimator />
        <AudioBridge />
        <VfxLayer />
        <CinemaDriver />
        <PostFx />
        <ViewportBridge store={store} controlsRef={controlsRef} />
        <InvalidateOnStore />
        {!cinematic && (
          <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
            <GizmoViewport axisColors={["#c9605a", "#7fbf8f", "#5b8fd6"]} labelColor="#0b0e12" />
          </GizmoHelper>
        )}
      </Canvas>
      {box !== null && (
        <div
          className="box-select"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      )}
      <ScreenCracks />
      {cutaway && <div className="viewport__badge">Cutaway: near half hidden</div>}
      {empty && (
        <div className="viewport__empty">
          <p className="eyebrow">Empty workspace</p>
          <p>Drag a part from the drawer, or click one to place it. Physics decides the rest.</p>
        </div>
      )}
      {contextLost && (
        <div className="viewport__lost" role="alert">
          The graphics context was lost (the GPU was reset or ran out of memory). Your design is
          safe — reload to continue.
          <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  );
}

const focusedMaterial = (
  view: { readonly materialFocusIds: ReadonlySet<string> | null },
  c: SimulationComponent,
) => view.materialFocusIds?.has(c.id) ?? false;
