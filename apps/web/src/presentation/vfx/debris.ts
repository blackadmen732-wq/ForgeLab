import type RAPIER_NS from "@dimforge/rapier3d-compat";
import {
  type BufferGeometry,
  type Color,
  IcosahedronGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { V3 } from "./recipes.js";

/**
 * Debris from a failed part, in two tiers:
 *
 *  A. Rigid fragments simulated by Rapier: they tumble, collide with the floor and with
 *     other machines' envelopes, use continuous collision detection so fast pieces do not
 *     tunnel, and report contact forces (impact sounds, and a camera-glass crack when one
 *     actually strikes the camera's protection collider).
 *  B. Smaller chunks moved ballistically with a floor bounce — cheap, no collisions.
 *
 * Tier C (grit and dust) is the particle system. None of this is physical truth: debris
 * cannot damage anything in the simulation (see docs/SHOWROOM.md, "Secondary
 * propagation"). Pieces are "pre-fractured" from the part's envelope: sized from it,
 * spawned inside it, and coloured like it.
 */
type Rapier = typeof RAPIER_NS;

let rapierPromise: Promise<Rapier> | null = null;
export function loadRapier(): Promise<Rapier> {
  rapierPromise ??= import("@dimforge/rapier3d-compat").then(async (m) => {
    const rapier = (m as unknown as { default?: Rapier }).default ?? (m as unknown as Rapier);
    await rapier.init();
    return rapier;
  });
  return rapierPromise;
}

export interface Obstacle {
  readonly center: V3;
  readonly half: V3;
}

export interface Impact {
  readonly position: V3;
  readonly force: number;
}

export interface CameraHit {
  readonly position: V3;
  readonly speed: number;
}

interface RigidPiece {
  readonly body: RAPIER_NS.RigidBody;
  readonly half: V3;
  readonly slot: number;
  readonly color: Color;
}

interface SimplePiece {
  pos: Vector3;
  vel: Vector3;
  rot: Quaternion;
  spin: Vector3;
  readonly half: V3;
  age: number;
  resting: boolean;
}

/** Relative speed above which a fragment cracks the camera's protective glass, m/s. */
export const CRACK_SPEED = 6;

const FIXED_DT = 1 / 60;
const m4 = new Matrix4();
const q = new Quaternion();
const p = new Vector3();
const s = new Vector3();
const axis = new Vector3();

/**
 * An irregular, faceted fragment filling roughly a unit cube: an icosahedron with its
 * vertices pushed in and out, flat-shaded — torn metal and spalled concrete rather than
 * neat boxes. Scaled per instance to the fragment's size.
 */
function chunkGeometry(random: () => number): BufferGeometry {
  const g = new IcosahedronGeometry(0.62, 0);
  const pos = g.getAttribute("position");
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i += 1) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 0.65 + random() * 0.55;
      seen.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export class DebrisField {
  readonly rigidMesh: InstancedMesh;
  readonly simpleMesh: InstancedMesh;
  #rapier: Rapier | null = null;
  #world: RAPIER_NS.World | null = null;
  #events: RAPIER_NS.EventQueue | null = null;
  #obstacles: RAPIER_NS.Collider[] = [];
  #guard: RAPIER_NS.RigidBody | null = null;
  #guardCollider: RAPIER_NS.Collider | null = null;
  #rigid: RigidPiece[] = [];
  #simple: SimplePiece[] = [];
  #accumulator = 0;
  #random: () => number;
  #rigidCapacity: number;
  #simpleCapacity: number;
  readonly onImpact: Array<(impact: Impact) => void> = [];
  readonly onCameraHit: Array<(hit: CameraHit) => void> = [];

  constructor(rigidCapacity: number, simpleCapacity: number, random: () => number) {
    this.#random = random;
    this.#rigidCapacity = rigidCapacity;
    this.#simpleCapacity = simpleCapacity;
    const material = new MeshStandardMaterial({
      metalness: 0.5,
      roughness: 0.6,
      flatShading: true,
    });
    this.rigidMesh = new InstancedMesh(chunkGeometry(random), material, rigidCapacity);
    this.simpleMesh = new InstancedMesh(chunkGeometry(random), material, simpleCapacity);
    for (const mesh of [this.rigidMesh, this.simpleMesh]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
    this.rigidMesh.name = "debris-rigid";
    this.simpleMesh.name = "debris-simple";
  }

  get active(): boolean {
    return this.#rigid.length > 0 || this.#simple.some((piece) => !piece.resting);
  }

  get rigidCount(): number {
    return this.#rigid.length;
  }

  async ready(): Promise<void> {
    if (this.#world !== null) return;
    const rapier = await loadRapier();
    this.#rapier = rapier;
    this.#world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.#events = new rapier.EventQueue(true);
    const floor = rapier.ColliderDesc.cuboid(400, 0.5, 400)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.8)
      .setRestitution(0.2);
    this.#world.createCollider(floor);
    // The camera's protective glass: a thin box kept in front of the lens.
    this.#guard = this.#world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    this.#guardCollider = this.#world.createCollider(
      rapier.ColliderDesc.cuboid(0.45, 0.3, 0.05)
        .setSensor(true)
        .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(rapier.ActiveCollisionTypes.ALL),
      this.#guard,
    );
  }

  /** Other machines' envelopes, so fragments bounce off them. */
  setObstacles(obstacles: readonly Obstacle[]): void {
    const world = this.#world;
    const rapier = this.#rapier;
    if (world === null || rapier === null) return;
    for (const c of this.#obstacles) world.removeCollider(c, false);
    this.#obstacles = obstacles.map((o) =>
      world.createCollider(
        rapier.ColliderDesc.cuboid(o.half[0], o.half[1], o.half[2])
          .setTranslation(o.center[0], o.center[1], o.center[2])
          .setFriction(0.6)
          .setRestitution(0.25),
      ),
    );
  }

  /** Keep the camera guard in front of the lens (every frame). */
  setCamera(position: Vector3, quaternion: Quaternion, forward: Vector3): void {
    const guard = this.#guard;
    if (guard === null) return;
    const at = position.clone().addScaledVector(forward, 0.6);
    guard.setNextKinematicTranslation({ x: at.x, y: at.y, z: at.z });
    guard.setNextKinematicRotation({
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    });
  }

  /**
   * Breaks `count` rigid and `simpleCount` simple fragments off a part centred at
   * `origin` with half extents `half`, thrown along `direction`.
   */
  spawn(
    origin: V3,
    half: V3,
    direction: V3,
    speed: readonly [number, number],
    pieceM: number,
    count: number,
    simpleCount: number,
    color: Color,
  ): void {
    const rnd = this.#random;
    const inside = (): Vector3 =>
      new Vector3(
        origin[0] + (rnd() - 0.5) * 1.6 * half[0],
        origin[1] + (rnd() - 0.5) * 1.6 * half[1],
        origin[2] + (rnd() - 0.5) * 1.6 * half[2],
      );
    const velocity = (from: Vector3): Vector3 => {
      // Outward from the part's centre, biased along the event's direction and upward.
      const out = from.clone().sub(new Vector3(...origin));
      if (out.lengthSq() < 1e-6) out.set(rnd() - 0.5, rnd(), rnd() - 0.5);
      out
        .normalize()
        .multiplyScalar(0.6)
        .add(new Vector3(...direction))
        .add(new Vector3(0, 0.5, 0));
      out.normalize();
      return out.multiplyScalar(speed[0] + (speed[1] - speed[0]) * rnd());
    };
    const size = (): V3 => {
      const a = pieceM * (0.5 + rnd());
      return [a * (0.5 + rnd() * 0.5), a * (0.3 + rnd() * 0.4), a * (0.4 + rnd() * 0.6)];
    };
    const world = this.#world;
    const rapier = this.#rapier;
    if (world !== null && rapier !== null) {
      for (let i = 0; i < count && this.#rigid.length < this.#rigidCapacity; i += 1) {
        const at = inside();
        const v = velocity(at);
        const h = size();
        const body = world.createRigidBody(
          rapier.RigidBodyDesc.dynamic()
            .setTranslation(at.x, at.y, at.z)
            .setLinvel(v.x, v.y, v.z)
            .setAngvel({ x: (rnd() - 0.5) * 12, y: (rnd() - 0.5) * 12, z: (rnd() - 0.5) * 12 })
            .setCcdEnabled(true)
            .setLinearDamping(0.05)
            .setAngularDamping(0.3),
        );
        world.createCollider(
          rapier.ColliderDesc.cuboid(h[0] / 2, h[1] / 2, h[2] / 2)
            .setDensity(7800)
            .setFriction(0.7)
            .setRestitution(0.3)
            .setActiveEvents(
              rapier.ActiveEvents.CONTACT_FORCE_EVENTS | rapier.ActiveEvents.COLLISION_EVENTS,
            )
            .setContactForceEventThreshold(2e4),
          body,
        );
        const slot = this.#rigid.length;
        this.#rigid.push({ body, half: h, slot, color });
        this.rigidMesh.setColorAt(slot, color);
      }
      this.rigidMesh.count = this.#rigid.length;
      if (this.rigidMesh.instanceColor) this.rigidMesh.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < simpleCount && this.#simple.length < this.#simpleCapacity; i += 1) {
      const at = inside();
      const h = size().map((x) => x * 0.5) as unknown as V3;
      this.simpleMesh.setColorAt(this.#simple.length, color);
      this.#simple.push({
        pos: at,
        vel: velocity(at).multiplyScalar(1.2),
        rot: new Quaternion().random(),
        spin: new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(14),
        half: h,
        age: 0,
        resting: false,
      });
    }
    this.simpleMesh.count = this.#simple.length;
    if (this.simpleMesh.instanceColor) this.simpleMesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    this.#stepRigid(dt);
    this.#stepSimple(dt);
  }

  #stepRigid(dt: number): void {
    const world = this.#world;
    const events = this.#events;
    if (world === null || events === null || this.#rigid.length === 0) return;
    this.#accumulator = Math.min(this.#accumulator + dt, FIXED_DT * 4);
    while (this.#accumulator >= FIXED_DT) {
      world.timestep = FIXED_DT;
      world.step(events);
      this.#accumulator -= FIXED_DT;
      events.drainContactForceEvents((event) => {
        const collider = world.getCollider(event.collider1());
        const t = collider?.translation();
        if (t === undefined) return;
        const impact = { position: [t.x, t.y, t.z] as V3, force: event.maxForceMagnitude() };
        for (const cb of this.onImpact) cb(impact);
      });
      events.drainCollisionEvents((h1, h2, started) => {
        const guard = this.#guardCollider;
        if (!started || guard === null) return;
        const other = h1 === guard.handle ? h2 : h2 === guard.handle ? h1 : null;
        if (other === null) return;
        const body = world.getCollider(other)?.parent();
        if (body === null || body === undefined) return;
        const v = body.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        const t = body.translation();
        const hit = { position: [t.x, t.y, t.z] as V3, speed };
        if (speed >= CRACK_SPEED) for (const cb of this.onCameraHit) cb(hit);
      });
    }
    for (const piece of this.#rigid) {
      const t = piece.body.translation();
      const r = piece.body.rotation();
      m4.compose(
        p.set(t.x, t.y, t.z),
        q.set(r.x, r.y, r.z, r.w),
        s.set(piece.half[0], piece.half[1], piece.half[2]),
      );
      this.rigidMesh.setMatrixAt(piece.slot, m4);
    }
    this.rigidMesh.instanceMatrix.needsUpdate = true;
  }

  #stepSimple(dt: number): void {
    if (this.#simple.length === 0) return;
    let moving = false;
    this.#simple.forEach((piece, i) => {
      if (!piece.resting) {
        piece.age += dt;
        piece.vel.y -= 9.81 * dt;
        piece.pos.addScaledVector(piece.vel, dt);
        const floor = piece.half[1] / 2;
        if (piece.pos.y < floor) {
          piece.pos.y = floor;
          piece.vel.y = -piece.vel.y * 0.3;
          piece.vel.x *= 0.6;
          piece.vel.z *= 0.6;
          piece.spin.multiplyScalar(0.5);
          if (Math.abs(piece.vel.y) < 0.4 && piece.vel.lengthSq() < 0.2) piece.resting = true;
        }
        const w = piece.spin.length();
        if (w > 1e-3)
          piece.rot.premultiply(q.setFromAxisAngle(axis.copy(piece.spin).divideScalar(w), w * dt));
        moving = true;
      }
      m4.compose(piece.pos, piece.rot, s.set(piece.half[0], piece.half[1], piece.half[2]));
      this.simpleMesh.setMatrixAt(i, m4);
    });
    if (moving) this.simpleMesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    const world = this.#world;
    if (world !== null) for (const piece of this.#rigid) world.removeRigidBody(piece.body);
    this.#rigid = [];
    this.#simple = [];
    this.rigidMesh.count = 0;
    this.simpleMesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.#events?.free();
    this.#world?.free();
    this.#world = null;
    this.rigidMesh.geometry.dispose();
    (this.rigidMesh.material as MeshStandardMaterial).dispose();
    this.simpleMesh.geometry.dispose();
  }
}
