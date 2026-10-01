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
  PointLight,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
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
import { damageState } from "../damageState.js";
import { getSettings, motionAllowed, type TierBudget } from "../settings.js";
import { CameraEffects } from "./camera.js";
import { addCrack, clearCracks } from "./cracks.js";
import { DebrisField, type Obstacle } from "./debris.js";
import { MarkLayer } from "./marks.js";
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
  smoke: 0.16,
  steam: 0.2,
  vapor: 0.18,
  dust: 0.16,
  fire: 0.05,
  sparks: 0.08,
  spray: 0.1,
  esmoke: 0.07,
};

type EmitCommand = Extract<EffectCommand, { type: "emit" }>;
type FollowCommand = Extract<EffectCommand, { type: "follow" }>;

interface Emitter {
  readonly cmd: EmitCommand;
  /** Set when the rate follows a published value of a part each frame. */
  readonly follow?: FollowCommand;
  age: number;
  carry: number;
}

/** Commands that start after a delay. */
type Delayable = Extract<EffectCommand, { type: "arc" | "shock" | "flash" | "light" }>;

interface Glow {
  readonly light: PointLight;
  age: number;
  duration: number;
  peak: number;
  flickerHz: number;
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
  const handle = meshRegistry.get(event.siteComponentId);
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

/** The live runtime, for the developer effects panel only. */
export const vfxDebug: { runtime: VfxRuntime | null } = { runtime: null };

export class VfxRuntime {
  readonly root = new Group();
  readonly systems: Record<ParticleKind, ParticleSystem>;
  readonly debris: DebrisField;
  readonly arcs: Arc[];
  readonly rings: Timed[];
  readonly flashes: Timed[];
  readonly cam = new CameraEffects();
  readonly marks: MarkLayer;
  readonly emitters: Emitter[] = [];
  readonly lights: Glow[];
  readonly #delayed: { cmd: Delayable; wait: number }[] = [];
  #seeded = mulberry32(1);
  #budget: TierBudget;
  #arcMaterial: LineBasicMaterial;
  #ringGeometry: RingGeometry;
  #sphere: SphereGeometry;
  #camera: Camera | null = null;
  #director: PresentationDirector | null = null;
  #invalidate: () => void = () => {};
  #last = 0;
  /** Presentation time scale: slow motion and pause in failure cinema. */
  timeScale: () => number = () => 1;

  setTimeScale(scale: () => number): void {
    this.timeScale = scale;
  }
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
    this.marks = new MarkLayer(root, budget.marks);
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
    // Always present at zero intensity: switching lights on and off would recompile every
    // lit material in the hall at the moment of the failure.
    this.lights = Array.from({ length: 2 }, () => {
      const light = new PointLight("#ffffff", 0, 10, 2);
      light.castShadow = false;
      root.add(light);
      return { light, age: 1, duration: 0, peak: 0, flickerHz: 0 };
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
    vfxDebug.runtime = this;
    this.#invalidate = invalidate;
    const off = director.on((event) => {
      if (event.type === "destruction") this.execute(event.event);
      else if (event.type === "reset" || event.type === "clear-effects") this.clearAll();
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
      if (vfxDebug.runtime === this) vfxDebug.runtime = null;
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
        case "follow":
          this.emitters.push({
            cmd: {
              type: "emit",
              system: cmd.system,
              origin: cmd.origin,
              direction: cmd.direction,
              spread: cmd.spread,
              speed: cmd.speed,
              rate: 0,
              duration: cmd.duration,
              life: cmd.life,
              size: cmd.size,
              radius: cmd.radius,
              delay: 0,
            },
            follow: { ...cmd, maxRate: cmd.maxRate * rateScale, perUnit: cmd.perUnit * rateScale },
            age: 0,
            carry: 0,
          });
          break;
        case "arc":
        case "shock":
        case "flash":
        case "light":
          if ((cmd.delay ?? 0) > 0) this.#delayed.push({ cmd, wait: cmd.delay! });
          else this.#start(cmd);
          break;
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
          damageState.markFractured(cmd.componentId);
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
        case "mark": {
          const target = meshRegistry.get(cmd.componentId)?.group;
          if (target === undefined) break;
          box.setFromObject(target);
          const centre = box.getCenter(new Vector3());
          const reach = Math.max(1, box.getSize(new Vector3()).length());
          const from = new Vector3(...cmd.origin).addScaledVector(
            new Vector3(...cmd.direction),
            reach,
          );
          // Aim at the event point first; fall back to the part's centre.
          if (
            !this.marks.add(
              cmd.kind,
              target,
              from,
              new Vector3(...cmd.origin),
              cmd.sizeM,
              this.random,
            )
          )
            this.marks.add(cmd.kind, target, from, centre, cmd.sizeM, this.random);
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

  #start(cmd: Delayable): void {
    const reduced = getSettings().reducedEffects;
    switch (cmd.type) {
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
      case "light": {
        // The free light, else the one closest to finishing.
        const glow =
          this.lights.find((g) => g.age >= g.duration) ??
          this.lights.reduce((a, b) => (a.duration - a.age < b.duration - b.age ? a : b));
        glow.light.position.set(...cmd.origin);
        glow.light.color.set(cmd.color);
        glow.light.distance = cmd.distance;
        glow.age = 0;
        glow.duration = cmd.duration;
        glow.peak = reduced ? cmd.intensity * 0.5 : cmd.intensity;
        // No strobing with reduced effects.
        glow.flickerHz = reduced ? 0 : (cmd.flickerHz ?? 0);
        break;
      }
    }
  }

  clearAll(): void {
    this.#broken.clear();
    damageState.clear();
    this.emitters.length = 0;
    this.#delayed.length = 0;
    for (const g of this.lights) {
      g.age = g.duration = 0;
      g.light.intensity = 0;
    }
    for (const s of Object.values(this.systems)) s.clear();
    this.debris.clear();
    this.marks.clear();
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
    const dt =
      (this.#last === 0 ? 0.016 : Math.min(0.05, (now - this.#last) / 1000)) * this.timeScale();
    this.#last = now;
    let busy = false;
    // Delayed starts.
    for (let i = this.#delayed.length - 1; i >= 0; i -= 1) {
      const d = this.#delayed[i]!;
      d.wait -= dt;
      busy = true;
      if (d.wait <= 0) {
        this.#delayed.splice(i, 1);
        this.#start(d.cmd);
      }
    }
    // Emitters.
    const reading = this.emitters.some((e) => e.follow !== undefined)
      ? this.#director?.getState().reading
      : undefined;
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
      let rate = e.cmd.rate;
      let speed = e.cmd.speed;
      if (e.follow !== undefined) {
        const f = e.follow;
        const part = reading?.components.find((c) => c.id === f.componentId);
        const value = part?.[f.field] ?? 0;
        rate = Math.min(f.maxRate, Math.max(0, value) * f.perUnit);
      } else if (e.cmd.decay !== undefined) {
        // A blowdown: mass flow falls with the driving pressure, exit speed with its root.
        const k = Math.exp(-e.age / e.cmd.decay);
        rate *= k;
        const sk = Math.sqrt(k);
        speed = [speed[0] * sk, speed[1] * sk];
      }
      e.carry += rate * dt;
      const n = Math.floor(e.carry);
      e.carry -= n;
      const system = this.systems[e.cmd.system];
      for (let k = 0; k < n; k += 1)
        system.spawn(
          e.cmd.origin,
          e.cmd.direction,
          e.cmd.spread,
          speed,
          e.cmd.life,
          e.cmd.size,
          e.cmd.radius,
          this.random,
        );
    }
    // Lights: a fast attack, then a decay; long ones (a fire) fade linearly. Flicker is
    // two beating sines, deterministic.
    for (const g of this.lights) {
      if (g.age >= g.duration) {
        g.light.intensity = 0;
        continue;
      }
      g.age += dt;
      busy = true;
      const t = Math.min(1, g.age / g.duration);
      const envelope = Math.min(1, g.age / 0.04) * (g.duration > 2 ? 1 - t : (1 - t) * (1 - t));
      const w = 2 * Math.PI * g.flickerHz * g.age;
      const flicker = g.flickerHz > 0 ? 0.65 + 0.35 * Math.sin(w) * Math.sin(1.7 * w + 1) : 1;
      g.light.intensity = g.peak * envelope * flicker;
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

  /**
   * Compile every effect material up front, so the first failure does not stall on shader
   * compilation at its most dramatic moment. Objects are made visible just for this.
   */
  prewarm(gl: WebGLRenderer, camera: Camera, scene: Scene): void {
    const hidden: Object3D[] = [];
    this.root.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const counts = [this.debris.rigidMesh, this.debris.simpleMesh].map((m) => m.count);
    this.debris.rigidMesh.count = 1;
    this.debris.simpleMesh.count = 1;
    try {
      gl.compile(this.root, camera, scene);
    } finally {
      for (const o of hidden) o.visible = false;
      this.debris.rigidMesh.count = counts[0]!;
      this.debris.simpleMesh.count = counts[1]!;
    }
  }

  /** Particle and debris counts for the developer panel. */
  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, s] of Object.entries(this.systems)) out[k] = s.alive;
    out["debris (rigid)"] = this.debris.rigidCount;
    out["marks"] = this.marks.count;
    out["emitters"] = this.emitters.length;
    out["lights"] = this.lights.filter((g) => g.age < g.duration).length;
    return out;
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
