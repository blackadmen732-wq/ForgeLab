import type { V3 } from "../environment/hall/plan.js";
import {
  WALKER,
  moveFlyer,
  moveWalker,
  placeFlyer,
  placeWalker,
  type Flyer,
  type NavWorld,
  type Walker,
} from "./collision.js";

/**
 * First-person movement for the walk and fly cameras: where the eye is, which way it
 * looks, how fast it is going. Speed eases in and out instead of switching on and off,
 * Shift sprints, and every move goes through collision.ts.
 *
 * No renderer and no DOM here: the React controller feeds it keys and elapsed time and
 * copies the pose to the camera; tests and the browser checks drive it directly.
 * Presentation only: a Navigator never touches the design or the simulation.
 */
export type NavMode = "walk" | "fly";

export interface NavInput {
  /** −1 … 1: backwards / forwards along the view. */
  readonly forward: number;
  /** −1 … 1: left / right. */
  readonly right: number;
  /** −1 … 1: down / up (fly only). */
  readonly up: number;
  readonly sprint: boolean;
}

export const NO_INPUT: NavInput = Object.freeze({ forward: 0, right: 0, up: 0, sprint: false });

/** Metres per second: a walking pace and a run; a hover and a dash across the hall. */
export const NAV_SPEED = Object.freeze({
  walk: Object.freeze({ normal: 1.6, sprint: 5.5 }),
  fly: Object.freeze({ normal: 7, sprint: 32 }),
});
/** Time constants of the speed easing, s. */
const ACCELERATE_S = 0.16;
const BRAKE_S = 0.11;
const PITCH_LIMIT = 1.5;
/** The free camera's speed can be scaled with the wheel between these. */
export const FLY_SCALE_RANGE: readonly [number, number] = [0.25, 4];

const emptyWorld = (world: NavWorld): NavWorld => ({
  plan: world.plan,
  walkBoxes: [],
  flyBoxes: [],
  machines: [],
});

export class Navigator {
  mode: NavMode;
  yaw = 0;
  pitch = 0;
  /** Collision on (the default) or passing through machines and fittings to look inside. */
  collide = true;
  /** Multiplier on the free camera's speed. */
  flyScale = 1;
  readonly velocity = { x: 0, y: 0, z: 0 };
  #world: NavWorld;
  #walker: Walker = { x: 0, y: 0, z: 0, vy: 0 };
  #flyer: Flyer = { x: 0, y: 2, z: 0 };

  constructor(mode: NavMode, world: NavWorld) {
    this.mode = mode;
    this.#world = world;
  }

  setWorld(world: NavWorld): void {
    this.#world = world;
  }

  get world(): NavWorld {
    return this.#world;
  }

  /** Where the eye is. */
  get eye(): V3 {
    return this.mode === "walk"
      ? [this.#walker.x, this.#walker.y + WALKER.eyeM, this.#walker.z]
      : [this.#flyer.x, this.#flyer.y, this.#flyer.z];
  }

  /** Height of the feet (walk) or of the camera (fly). */
  get baseY(): number {
    return this.mode === "walk" ? this.#walker.y : this.#flyer.y;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
  }

  get falling(): boolean {
    return this.mode === "walk" && this.#walker.vy !== 0;
  }

  /** Unit view direction. */
  get direction(): V3 {
    const c = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c];
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  /** Turns to face a point. */
  lookAt(target: V3): void {
    const [x, y, z] = this.eye;
    const dx = target[0] - x;
    const dy = target[1] - y;
    const dz = target[2] - z;
    const flat = Math.hypot(dx, dz);
    if (flat < 1e-6 && Math.abs(dy) < 1e-6) return;
    this.setLook(flat < 1e-6 ? this.yaw : Math.atan2(-dx, -dz), Math.atan2(dy, flat));
  }

  /**
   * Puts the eye at (or, on foot, on the surface under) a point, clear of obstacles.
   * On foot `eye[1]` picks the storey: the highest surface not above it.
   */
  place(eye: V3, mode: NavMode = this.mode): void {
    this.mode = mode;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    const world = this.collide ? this.#world : emptyWorld(this.#world);
    if (mode === "walk") this.#walker = placeWalker(world, eye[0], eye[2], eye[1]);
    else this.#flyer = placeFlyer(world, eye[0], eye[1], eye[2]);
  }

  /**
   * Advances by dt seconds under the given input. Returns true while there is motion left
   * to play out (coasting to a stop, or falling), so the caller keeps its loop running.
   */
  step(input: NavInput, dt: number): boolean {
    if (dt <= 0) return this.speed > 0.01 || this.falling;
    const walking = this.mode === "walk";
    const cp = walking ? 1 : Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp;
    const fy = walking ? 0 : Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let wx = fx * input.forward + rx * input.right;
    let wy = fy * input.forward + (walking ? 0 : input.up);
    let wz = fz * input.forward + rz * input.right;
    const length = Math.hypot(wx, wy, wz);
    if (length > 1) {
      wx /= length;
      wy /= length;
      wz /= length;
    }
    const pace = NAV_SPEED[this.mode];
    const top = (input.sprint ? pace.sprint : pace.normal) * (walking ? 1 : this.flyScale);
    const k = 1 - Math.exp(-dt / (length > 1e-3 ? ACCELERATE_S : BRAKE_S));
    const v = this.velocity;
    v.x += (wx * top - v.x) * k;
    v.y += (wy * top - v.y) * k;
    v.z += (wz * top - v.z) * k;
    if (length <= 1e-3 && this.speed < 0.02) v.x = v.y = v.z = 0;

    const world = this.collide ? this.#world : emptyWorld(this.#world);
    if (walking) {
      const w = this.#walker;
      const x0 = w.x;
      const z0 = w.z;
      moveWalker(world, w, v.x * dt, v.z * dt, dt);
      // Whatever stopped the move also stops the speed, so nobody grinds against a wall.
      v.x = (w.x - x0) / dt;
      v.z = (w.z - z0) / dt;
      v.y = 0;
    } else {
      const p = this.#flyer;
      const x0 = p.x;
      const y0 = p.y;
      const z0 = p.z;
      moveFlyer(world, p, v.x * dt, v.y * dt, v.z * dt);
      v.x = (p.x - x0) / dt;
      v.y = (p.y - y0) / dt;
      v.z = (p.z - z0) / dt;
    }
    return this.speed > 0.01 || this.falling || length > 1e-3;
  }
}
