import "../../collab/collab.css";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { useCollab, useCollabController } from "../../collab/context.js";
import { type OrbEntry, activityText, orbDetail, orbEntries, orbPulse } from "../../collab/orbs.js";
import { useEditor } from "../store/context.js";
import { meshRegistry } from "./meshes.js";

/**
 * Teammates as coloured orbs over the parts they are working on (see collab/orbs.ts).
 * Presentation only: positions follow the parts' meshes, sizes follow the camera, and
 * the pulse follows each teammate's voice. Nothing here is read by the simulation.
 */
export function PresenceOrbs() {
  const controller = useCollabController();
  const roster = useCollab((s) => s.session.roster);
  const voice = useCollab((s) => s.voice.members);
  const workspaceId = useCollab((s) => s.session.self.workspaceId);
  const components = useEditor((v) => v.snapshot.components);
  const preview = useSyncExternalStore(orbPreview.subscribe, orbPreview.get, orbPreview.get);
  const ids = new Set(components.map((c) => c.id));
  const live =
    roster === undefined || controller === null
      ? []
      : orbEntries(roster, voice ?? [], controller.userId, workspaceId ?? null, (id) =>
          ids.has(id),
        );
  const entries = [...live, ...preview.filter((p) => ids.has(p.focus))];
  return (
    <group name="presence-orbs">
      {entries.map((entry) => (
        <Orb key={entry.userId} entry={entry} />
      ))}
    </group>
  );
}

function Orb({ entry }: { readonly entry: OrbEntry }) {
  const [rig] = useState(() => new OrbRig(entry.color));
  const [label, setLabel] = useState<HTMLDivElement | null>(null);
  useEffect(() => () => rig.dispose(), [rig]);
  useFrame(({ camera, clock, invalidate }) => {
    const handle = meshRegistry.get(entry.focus);
    if (handle === undefined) {
      rig.hide();
      return;
    }
    const detail = rig.update(handle.group, camera.position, entry.level, clock.getElapsedTime());
    showLabel(label, detail === "label");
    // The canvas renders on demand: keep frames coming while the orb is pulsing.
    if (entry.level > 0) invalidate();
  });
  return (
    <primitive object={rig.root}>
      <Html position={[0, 0.6, 0]} center zIndexRange={[20, 0]} pointerEvents="none">
        <div ref={setLabel} className="presence-orb__label" style={{ borderColor: entry.color }}>
          <span className="presence-orb__name">
            {entry.name}
            <span
              className={`presence-orb__mic${entry.speaking ? " is-speaking" : ""}${entry.muted ? " is-muted" : ""}`}
              aria-label={entry.muted ? "muted" : entry.speaking ? "speaking" : "mic on"}
            />
          </span>
          <span className="presence-orb__activity">
            {entry.focus} · {activityText(entry.activity)}
          </span>
        </div>
      </Html>
    </primitive>
  );
}

function showLabel(label: HTMLDivElement | null, show: boolean): void {
  if (label !== null) label.style.display = show ? "" : "none";
}

const GLOW = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
})();

/** The orb's Three.js objects. Mutable, so kept out of React state (see CLAUDE.md §0). */
class OrbRig {
  readonly root = new Group();
  readonly #core: Mesh;
  readonly #halo: Sprite;
  readonly #tether: Line;
  readonly #box = new Box3();
  readonly #top = new Vector3();
  readonly #size = new Vector3();

  constructor(color: string) {
    const c = new Color(color);
    this.#core = new Mesh(
      new SphereGeometry(0.5, 24, 16),
      new MeshBasicMaterial({ color: c.clone().lerp(new Color("#ffffff"), 0.35) }),
    );
    this.#halo = new Sprite(
      new SpriteMaterial({
        map: GLOW,
        color: c,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.#halo.scale.setScalar(3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    this.#tether = new Line(
      geometry,
      new LineBasicMaterial({ color: c, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.#tether.frustumCulled = false;
    this.root.add(this.#core, this.#halo);
    this.root.renderOrder = 10;
    // The tether is drawn in world space, so it is a sibling of the orb, not a child.
    this.root.userData["tether"] = this.#tether;
  }

  /** Places the orb above the part, sized for the camera; returns the detail level. */
  update(
    part: Group,
    cameraM: Vector3,
    level: number,
    timeSec: number,
  ): ReturnType<typeof orbDetail> {
    this.#box.setFromObject(part);
    this.#box.getSize(this.#size);
    const radius = this.#size.length() / 2;
    this.#box.getCenter(this.#top);
    this.#top.y = this.#box.max.y;
    const lift = Math.min(Math.max(radius * 0.6, 1.2), 12);
    this.root.position.set(this.#top.x, this.#top.y + lift, this.#top.z);
    const distance = cameraM.distanceTo(this.root.position);
    const detail = orbDetail(distance, radius);
    // Roughly constant on screen: an orb never vanishes across the hall nor fills it close up.
    const base = Math.min(Math.max(distance * 0.018, 0.25), 3) * (detail === "dot" ? 0.45 : 1);
    this.root.scale.setScalar(base * orbPulse(level, timeSec));
    this.#halo.visible = detail !== "dot";
    (this.#halo.material as SpriteMaterial).opacity = 0.55 + 0.45 * Math.min(1, level);
    const tether = this.#tether;
    if (tether.parent === null && this.root.parent !== null) this.root.parent.add(tether);
    tether.visible = detail !== "dot";
    const p = tether.geometry.getAttribute("position") as Float32BufferAttribute;
    p.setXYZ(0, this.root.position.x, this.root.position.y, this.root.position.z);
    p.setXYZ(1, this.#top.x, this.#top.y, this.#top.z);
    p.needsUpdate = true;
    this.root.visible = true;
    return detail;
  }

  hide(): void {
    this.root.visible = false;
    this.#tether.visible = false;
  }

  dispose(): void {
    this.#tether.removeFromParent();
    this.#core.geometry.dispose();
    (this.#core.material as MeshBasicMaterial).dispose();
    (this.#halo.material as SpriteMaterial).dispose();
    this.#tether.geometry.dispose();
    (this.#tether.material as LineBasicMaterial).dispose();
  }
}

/**
 * Preview orbs for the debug handle (`/app?debug`): lets a browser test or a developer see
 * orbs without a live team. Presentation only, never sent anywhere.
 */
export const orbPreview = (() => {
  let entries: readonly OrbEntry[] = [];
  const listeners = new Set<() => void>();
  return {
    get: () => entries,
    set(next: readonly OrbEntry[]) {
      entries = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();
