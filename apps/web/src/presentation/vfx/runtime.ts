import type { RootState } from "@react-three/fiber";
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  type Camera,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { HALL } from "../../builder/scene/environment/hall/geometry.js";
import { materialColor } from "../../builder/scene/appearance.js";
import { meshRegistry } from "../../builder/scene/meshes.js";
import type { AudioEngine } from "../audio/engine.js";
import type { PresentationDirector } from "../director.js";
import type { DestructionEvent } from "../destruction.js";
import { getSettings, motionAllowed, type TierBudget } from "../settings.js";
import { CameraEffects } from "./camera.js";
import { addCrack, clearCracks } from "./cracks.js";
import { DebrisField, type Obstacle } from "./debris.js";
import { ParticleSystem } from "./particles.js";
import {
  recipeFor,
  type EffectCommand,
  type ParticleKind,
  type RecipeContext,
  type V3,
} from "./recipes.js";

/**
 * The destruction director on the scene side: turns each DestructionEvent the
 * presentation director publishes into effects, via the pure recipes. It owns the pooled
 * particle systems, arcs, shock rings, flashes, debris field and camera effects, and
 * clears all of them when the run resets. It reads presentation state only.
 */
const SHARE: Readonly<Record<ParticleKind, number>> = {
  smoke: 0.2,
  steam: 0.25,
  vapor: 0.2,
  dust: 0.2,
  fire: 0.05,
  sparks: 0.1,
};

interface Emitter {
  readonly cmd: Extract<EffectCommand, { type: "emit" }>;
  age: number;
  carry: number;
}

interface Arc {
  readonly line: Line;
  from: Vector3;
  to: Vector3;
  age: number;
  duration: number;
  strikes: number;
  nextJitter: number;
}

interface Timed {
  readonly mesh: Mesh;
  age: number;
  duration: number;
  radius: number;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const box = new Box3();
const tmp = new Vector3();

function recipeContext(event: DestructionEvent): RecipeContext {
  const handle = meshRegistry.get(event.componentId);
  const [x, y, z] = event.worldPosition;
  if (handle === undefined) {
    const r = event.radiusM;
    return {
      ends: [
        [x - r, y, z],
        [x + r, y, z],
      ],
      top: [x, y + r, z],
    };
  }
  box.setFromObject(handle.group);
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? "x" : size.z >= size.y ? "z" : "y";
  const a = c.clone();
  const b = c.clone();
  a[axis] = box.min[axis];
  b[axis] = box.max[axis];
  return {
    ends: [
      [a.x, a.y, a.z],
      [b.x, b.y, b.z],
    ],
    top: [c.x, box.max.y, c.z],
  };
}

function obstaclesExcept(id: string): Obstacle[] {
  const out: Obstacle[] = [];
  for (const [other, handle] of meshRegistry) {
    if (other === id || !handle.group.visible) continue;
    box.setFromObject(handle.group);
    if (box.isEmpty()) continue;
    const c = box.getCenter(tmp);
    const s = box.getSize(new Vector3());
    out.push({ center: [c.x, c.y, c.z], half: [s.x / 2, s.y / 2, s.z / 2] });
  }
  return out;
}

export class VfxRuntime {
  readonly root = new Group();
  readonly systems: Record<ParticleKind, ParticleSystem>;
  readonly debris: DebrisField;
  readonly arcs: Arc[];
  readonly rings: Timed[];
  readonly flashes: Timed[];
  readonly cam = new CameraEffects();
  readonly emitters: Emitter[] = [];
  #seeded = mulberry32(1);
  #budget: TierBudget;
  #arcMaterial: LineBasicMaterial;
  #ringGeometry: RingGeometry;
  #sphere: SphereGeometry;
  #camera: Camera | null = null;
  #director: PresentationDirector | null = null;
  #invalidate: () => void = () => {};
  #last = 0;
  /** Parts that already shed debris this run: one break-up per part, however many failures it raises. */
  #broken = new Set<string>();
  #forward = new Vector3();

  constructor(budget: TierBudget) {
    this.#budget = budget;
    // Seeded so a replayed failure throws the same debris.
    this.systems = Object.fromEntries(
      (Object.keys(SHARE) as ParticleKind[]).map((k) => [
        k,
        new ParticleSystem(k, Math.max(64, Math.round(budget.particles * SHARE[k]))),
      ]),
    ) as Record<ParticleKind, ParticleSystem>;
    this.debris = new DebrisField(budget.debrisRigid * 3, budget.debrisSimple * 3, () =>
      this.random(),
    );
    const root = this.root;
    root.name = "vfx";
    for (const s of Object.values(this.systems)) root.add(s.points);
    root.add(this.debris.rigidMesh, this.debris.simpleMesh);
    const arcMaterial = (this.#arcMaterial = new LineBasicMaterial({
      color: "#d8ecff",
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    this.arcs = Array.from({ length: 4 }, () => {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(40 * 3), 3));
      const line = new Line(g, arcMaterial);
      line.visible = false;
      line.frustumCulled = false;
      root.add(line);
      return {
        line,
        from: new Vector3(),
        to: new Vector3(),
        age: 1,
        duration: 0,
        strikes: 0,
        nextJitter: 0,
      };
    });
    const ringGeometry = (this.#ringGeometry = new RingGeometry(0.92, 1, 96).rotateX(-Math.PI / 2));
    this.rings = Array.from({ length: 3 }, () => {
      const mesh = new Mesh(
        ringGeometry,
        new MeshBasicMaterial({
          color: "#ffe9d0",
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
          toneMapped: false,
        }),
      );
      mesh.visible = false;
      root.add(mesh);
      return { mesh, age: 1, duration: 0, radius: 1 };
    });
    const sphere = (this.#sphere = new SphereGeometry(1, 24, 16));
    this.flashes = Array.from({ length: 4 }, () => {
      const mesh = new Mesh(
        sphere,
        new MeshBasicMaterial({
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.visible = false;
      root.add(mesh);
      return { mesh, age: 1, duration: 0, radius: 1 };
    });
  }

  /** Seeded so a replayed failure throws the same debris. */
  random = (): number => this.#seeded();

  reseed(seed: number): void {
    this.#seeded = mulberry32(seed);
  }

  setScale(scale: number): void {
    for (const s of Object.values(this.systems)) s.setScale(scale);
  }

  /** Subscribes to the director; returns the unsubscribe. */
  connect(
    director: PresentationDirector,
    audio: AudioEngine | null,
    camera: Camera,
    invalidate: () => void,
  ): () => void {
    this.#camera = camera;
    this.#director = director;
    this.#invalidate = invalidate;
    const off = director.on((event) => {
      if (event.type === "destruction") this.execute(event.event);
      else if (event.type === "reset") this.clearAll();
    });
    this.debris.onImpact.length = 0;
    this.debris.onImpact.push((impact) => audio?.impact(impact.position, impact.force));
    this.debris.onCameraHit.length = 0;
    this.debris.onCameraHit.push((hit) => {
      if (!getSettings().screenCrack) return;
      const v = new Vector3(...hit.position).project(camera);
      addCrack((v.x + 1) / 2, (1 - v.y) / 2, Math.min(1, hit.speed / 25));
      audio?.impact(hit.position, 5e5);
    });
    return () => {
      off();
      this.clearAll();
    };
  }

  execute(event: DestructionEvent): void {
    const settings = getSettings();
    const reduced = settings.reducedEffects;
    const rateScale = this.#budget.particles / 8000;
    this.reseed(hashSeed(event.eventId));
    for (const cmd of recipeFor(event, recipeContext(event))) {
      switch (cmd.type) {
        case "emit":
          this.emitters.push({
            cmd: { ...cmd, rate: cmd.rate * rateScale },
            age: -cmd.delay,
            carry: 0,
          });
          break;
        case "arc": {
          const arc = this.arcs.find((a) => a.age >= a.duration) ?? this.arcs[0]!;
          arc.from.set(...cmd.from);
          arc.to.set(...cmd.to);
          arc.age = 0;
          arc.duration = reduced ? Math.min(0.3, cmd.duration) : cmd.duration;
          arc.strikes = cmd.strikes;
          arc.nextJitter = 0;
          break;
        }
        case "shock": {
          const ring = this.rings.find((r) => r.age >= r.duration) ?? this.rings[0]!;
          ring.mesh.position.set(cmd.origin[0], 0.05, cmd.origin[2]);
          ring.age = 0;
          ring.duration = cmd.duration;
          ring.radius = cmd.radius;
          break;
        }
        case "flash": {
          if (reduced) break;
          const flash = this.flashes.find((f) => f.age >= f.duration) ?? this.flashes[0]!;
          flash.mesh.position.set(...cmd.origin);
          (flash.mesh.material as MeshBasicMaterial).color.set(cmd.color);
          flash.age = 0;
          flash.duration = cmd.duration;
          flash.radius = cmd.radius;
          break;
        }
        case "ceiling-dust":
          this.emitters.push({
            cmd: {
              type: "emit",
              system: "dust",
              origin: [cmd.origin[0], HALL.eaveM - 1.5, cmd.origin[2]],
              direction: [0, -1, 0],
              spread: 0.3,
              speed: [0.3, 1.5],
              rate: 900 * cmd.amount * rateScale,
              duration: 1.6,
              life: [7, 12],
              size: [0.15, 1.6],
              radius: cmd.radius,
              delay: 0.15,
            },
            age: -0.15,
            carry: 0,
          });
          break;
        case "debris": {
          if (this.#broken.has(cmd.componentId)) break;
          this.#broken.add(cmd.componentId);
          // The part's own material colour (the live mesh may be tinted red as failed).
          const part = this.#director
            ?.getState()
            .reading?.components.find((c) => c.id === cmd.componentId);
          const color = part !== undefined ? materialColor(part.materialId) : new Color("#8a939e");
          const ctx = recipeContext(event);
          const half: V3 = [
            Math.max(0.3, Math.abs(ctx.ends[1][0] - ctx.ends[0][0]) / 2),
            Math.max(0.3, ctx.top[1] - event.worldPosition[1] || event.radiusM / 2),
            Math.max(0.3, Math.abs(ctx.ends[1][2] - ctx.ends[0][2]) / 2 || event.radiusM / 2),
          ];
          const rigid = Math.round(cmd.amount * this.#budget.debrisRigid);
          const simple = Math.round(cmd.amount * this.#budget.debrisSimple);
          void this.debris.ready().then(() => {
            this.debris.setObstacles(obstaclesExcept(cmd.componentId));
            this.debris.spawn(
              cmd.origin,
              half,
              cmd.direction,
              cmd.speed,
              cmd.pieceM,
              rigid,
              simple,
              color,
            );
            this.#invalidate();
          });
          break;
        }
        case "camera":
          this.cam.add(
            cmd.origin,
            this.#camera!.position,
            cmd.trauma,
            cmd.kick,
            cmd.flash,
            settings.cameraEffectsIntensity,
            motionAllowed(settings),
            reduced,
          );
          break;
      }
    }
    this.#invalidate();
  }

  clearAll(): void {
    this.#broken.clear();
    this.emitters.length = 0;
    for (const s of Object.values(this.systems)) s.clear();
    this.debris.clear();
    for (const a of this.arcs) {
      a.age = a.duration = 0;
      a.line.visible = false;
    }
    for (const t of [...this.rings, ...this.flashes]) {
      t.age = t.duration = 0;
      t.mesh.visible = false;
    }
    this.cam.clear();
    clearCracks();
  }

  /** Undo last frame's camera offset before the orbit controls read the camera. */
  restoreCamera(camera: Camera): void {
    this.cam.restore(camera);
  }

  frame(state: RootState): void {
    const now = performance.now();
    const dt = this.#last === 0 ? 0.016 : Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    let busy = false;
    // Emitters.
    for (let i = this.emitters.length - 1; i >= 0; i -= 1) {
      const e = this.emitters[i]!;
      e.age += dt;
      if (e.age < 0) {
        busy = true;
        continue;
      }
      if (e.age > e.cmd.duration) {
        this.emitters.splice(i, 1);
        continue;
      }
      busy = true;
      e.carry += e.cmd.rate * dt;
      const n = Math.floor(e.carry);
      e.carry -= n;
      const system = this.systems[e.cmd.system];
      for (let k = 0; k < n; k += 1)
        system.spawn(
          e.cmd.origin,
          e.cmd.direction,
          e.cmd.spread,
          e.cmd.speed,
          e.cmd.life,
          e.cmd.size,
          e.cmd.radius,
          this.random,
        );
    }
    for (const s of Object.values(this.systems)) {
      if (s.alive > 0 || busy) {
        s.update(dt);
        if (s.alive > 0) busy = true;
      }
    }
    // Arcs: a jagged path re-drawn every few frames, flickering between strikes.
    for (const arc of this.arcs) {
      if (arc.age >= arc.duration) {
        arc.line.visible = false;
        continue;
      }
      arc.age += dt;
      busy = true;
      arc.nextJitter -= dt;
      const strikePhase = (arc.age / arc.duration) * arc.strikes;
      const on = strikePhase % 1 < 0.6;
      arc.line.visible = on;
      if (on && arc.nextJitter <= 0) {
        arc.nextJitter = 0.045;
        const pos = arc.line.geometry.getAttribute("position") as BufferAttribute;
        const count = pos.count;
        const length = arc.from.distanceTo(arc.to);
        for (let i = 0; i < count; i += 1) {
          const t = i / (count - 1);
          const envelope = Math.sin(Math.PI * t);
          tmp.lerpVectors(arc.from, arc.to, t);
          pos.setXYZ(
            i,
            tmp.x + (this.random() - 0.5) * 0.25 * length * envelope * 0.3,
            tmp.y + (this.random() - 0.2) * 0.3 * length * envelope * 0.3,
            tmp.z + (this.random() - 0.5) * 0.25 * length * envelope * 0.3,
          );
        }
        pos.needsUpdate = true;
      }
    }
    // Shock rings expand along the floor and fade; flashes swell and fade.
    for (const ring of this.rings) {
      if (ring.age >= ring.duration) {
        ring.mesh.visible = false;
        continue;
      }
      ring.age += dt;
      busy = true;
      const t = Math.min(1, ring.age / ring.duration);
      const r = ring.radius * (1 - Math.pow(1 - t, 2.5));
      ring.mesh.visible = true;
      ring.mesh.scale.set(r, 1, r);
      (ring.mesh.material as MeshBasicMaterial).opacity = 0.35 * (1 - t);
    }
    for (const flash of this.flashes) {
      if (flash.age >= flash.duration) {
        flash.mesh.visible = false;
        continue;
      }
      flash.age += dt;
      busy = true;
      const t = Math.min(1, flash.age / flash.duration);
      flash.mesh.visible = true;
      flash.mesh.scale.setScalar(flash.radius * (0.6 + 0.6 * t));
      (flash.mesh.material as MeshBasicMaterial).opacity = (1 - t) * (1 - t);
    }
    // Debris and the camera guard.
    state.camera.getWorldDirection(this.#forward);
    this.debris.setCamera(state.camera.position, state.camera.quaternion, this.#forward);
    if (this.debris.active) {
      this.debris.update(dt);
      busy = true;
    }
    // Camera effects last, after the controls have placed the camera.
    this.cam.apply(state.camera, dt);
    state.gl.toneMappingExposure = this.cam.exposure;
    if (this.cam.busy) busy = true;
    if (busy) state.invalidate();
  }

  dispose(): void {
    for (const s of Object.values(this.systems)) s.dispose();
    this.debris.dispose();
    this.#arcMaterial.dispose();
    for (const a of this.arcs) a.line.geometry.dispose();
    this.#ringGeometry.dispose();
    this.#sphere.dispose();
    for (const t of [...this.rings, ...this.flashes])
      (t.mesh.material as MeshBasicMaterial).dispose();
  }
}
