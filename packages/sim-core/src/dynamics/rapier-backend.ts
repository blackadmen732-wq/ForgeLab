import { quaternion, vec3 } from "@forgelab/shared";
import type { ComponentId, PhysicalProperties, SimulationComponent } from "../component.js";
import { geometryLocalHalfExtentsM } from "../geometry.js";
import type { DynamicsBackend, DynamicsStepContext, DynamicsStepResult } from "./backend.js";

/**
 * OPTIONAL, NON-AUTHORITATIVE rigid-body backend built on Rapier.
 *
 * WHY IT EXISTS
 *   The built-in backend deliberately has no collision between components: a falling
 *   part passes straight through whatever is under it and stops at the ground plane.
 *   Rapier fills that gap, so debris in the workspace piles up instead of interpenetrating.
 *
 * WHAT IT IS NOT
 *   It is not the source of physical truth and it never will be. Support resolution, load
 *   propagation, stress and failure are decided by `systems/structural.ts` and handed to
 *   this backend as an input; all this class is allowed to do is move bodies the solver
 *   has already declared unsupported. Every result ForgeLab reports as a physical
 *   measurement is produced without it, and the determinism tests run against the built-in
 *   backend precisely so that no guarantee depends on a WASM build.
 *
 * LOADING
 *   Rapier ships as WebAssembly and must be initialised before use, so this module imports
 *   it dynamically inside `init()`. Importing this file costs nothing until you call that.
 *
 * DETERMINISM
 *   Rapier is deterministic for a fixed build, a fixed step and a fixed body order, and
 *   this backend feeds it bodies in id order to hold up its end of that. Across different
 *   Rapier versions it is not guaranteed, which is one more reason it is not authoritative.
 */
export class RapierDynamicsBackend implements DynamicsBackend {
  readonly id = "rapier";

  #rapier: RapierModule | undefined;
  #world: RapierWorld | undefined;
  #bodies = new Map<ComponentId, RapierBody>();
  #signatures = new Map<ComponentId, string>();
  #gravityY = Number.NaN;

  /** Loads and initialises the Rapier WASM module. Must be awaited before `step()`. */
  async init(): Promise<void> {
    if (this.#rapier !== undefined) return;
    const module = (await import("@dimforge/rapier3d-compat")) as unknown as RapierModule;
    await module.init();
    this.#rapier = module;
  }

  get ready(): boolean {
    return this.#rapier !== undefined;
  }

  step(context: DynamicsStepContext): DynamicsStepResult {
    const rapier = this.#rapier;
    if (rapier === undefined) return new Map();

    const gravityY = context.gravityAccelerationMps2.y;
    if (this.#world === undefined || this.#gravityY !== gravityY) {
      this.#world?.free();
      this.#world = new rapier.World({ x: 0, y: gravityY, z: 0 });
      this.#bodies.clear();
      this.#signatures.clear();
      this.#gravityY = gravityY;
    }
    const world = this.#world;
    world.timestep = context.fixedTimestepSec;

    const seen = new Set<ComponentId>();
    for (const component of context.components) {
      seen.add(component.id);
      this.#syncBody(rapier, world, component, context);
    }
    for (const [id, body] of [...this.#bodies]) {
      if (seen.has(id)) continue;
      world.removeRigidBody(body);
      this.#bodies.delete(id);
      this.#signatures.delete(id);
    }

    world.step();

    const updates = new Map<ComponentId, PhysicalProperties>();
    for (const component of context.components) {
      const body = this.#bodies.get(component.id);
      if (body === undefined) continue;
      const physical = component.state.physical;

      if (component.state.support.mode !== "free") {
        if (
          physical.linearVelocityMps.x !== 0 ||
          physical.linearVelocityMps.y !== 0 ||
          physical.linearVelocityMps.z !== 0
        ) {
          updates.set(component.id, { ...physical, linearVelocityMps: vec3(0, 0, 0) });
        }
        continue;
      }

      const t = body.translation();
      const r = body.rotation();
      const v = body.linvel();
      const w = body.angvel();
      updates.set(component.id, {
        ...physical,
        positionM: vec3(t.x, t.y, t.z),
        rotation: quaternion(r.x, r.y, r.z, r.w),
        linearVelocityMps: vec3(v.x, v.y, v.z),
        angularVelocityRadPerSec: vec3(w.x, w.y, w.z),
      });
    }

    return updates;
  }

  dispose(): void {
    this.#world?.free();
    this.#world = undefined;
    this.#bodies.clear();
    this.#signatures.clear();
  }

  #syncBody(
    rapier: RapierModule,
    world: RapierWorld,
    component: SimulationComponent,
    context: DynamicsStepContext,
  ): void {
    const free = component.state.support.mode === "free";
    const half = geometryLocalHalfExtentsM(component.geometry);
    const signature = `${free ? "dyn" : "fixed"}:${half.x}:${half.y}:${half.z}`;
    const existing = this.#bodies.get(component.id);

    if (existing !== undefined && this.#signatures.get(component.id) === signature) {
      if (!free) {
        const physical = component.state.physical;
        existing.setNextKinematicTranslation({
          x: physical.positionM.x,
          y: physical.positionM.y,
          z: physical.positionM.z,
        });
      }
      return;
    }

    if (existing !== undefined) {
      world.removeRigidBody(existing);
      this.#bodies.delete(component.id);
    }

    const physical = component.state.physical;
    const description = free
      ? rapier.RigidBodyDesc.dynamic()
      : rapier.RigidBodyDesc.kinematicPositionBased();
    description
      .setTranslation(physical.positionM.x, physical.positionM.y, physical.positionM.z)
      .setRotation({
        x: physical.rotation.x,
        y: physical.rotation.y,
        z: physical.rotation.z,
        w: physical.rotation.w,
      })
      .setLinvel(
        physical.linearVelocityMps.x,
        physical.linearVelocityMps.y,
        physical.linearVelocityMps.z,
      );

    const body = world.createRigidBody(description);
    // Colliders are cuboids of the component's bounding box: enough for "things stack and
    // do not interpenetrate", and honest about not being the real vessel shape.
    const collider = rapier.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(
      densityFor(component, half),
    );
    world.createCollider(collider, body);

    this.#bodies.set(component.id, body);
    this.#signatures.set(component.id, signature);
    this.#ensureGround(rapier, world, context);
  }

  #ensureGround(rapier: RapierModule, world: RapierWorld, context: DynamicsStepContext): void {
    if (this.#bodies.has(GROUND_ID)) return;
    const description = rapier.RigidBodyDesc.fixed().setTranslation(
      0,
      context.settings.groundLevelM - GROUND_HALF_THICKNESS_M,
      0,
    );
    const body = world.createRigidBody(description);
    world.createCollider(
      rapier.ColliderDesc.cuboid(
        GROUND_HALF_EXTENT_M,
        GROUND_HALF_THICKNESS_M,
        GROUND_HALF_EXTENT_M,
      ),
      body,
    );
    this.#bodies.set(GROUND_ID, body);
    this.#signatures.set(GROUND_ID, "ground");
  }
}

const GROUND_ID = "__forgelab_ground__";
const GROUND_HALF_EXTENT_M = 500;
const GROUND_HALF_THICKNESS_M = 0.5;

/**
 * Density that makes Rapier's cuboid collider weigh what ForgeLab says the part weighs.
 *
 * The collider is a bounding box, not the real shape, so handing Rapier the material
 * density would give a cylinder the mass of its bounding prism. Deriving density from
 * ForgeLab's own mass keeps the two in agreement.
 */
function densityFor(component: SimulationComponent, half: { x: number; y: number; z: number }) {
  const boxVolume = 8 * half.x * half.y * half.z;
  if (!(boxVolume > 0)) return 1;
  return component.massKg / boxVolume;
}

/* ------------------------------------------------------------------------------------ *
 * Minimal structural types for the parts of Rapier this backend touches.
 * Declared locally so that `@forgelab/sim-core` type-checks with Rapier absent.
 * ------------------------------------------------------------------------------------ */

interface RapierVector {
  x: number;
  y: number;
  z: number;
}

interface RapierRotation extends RapierVector {
  w: number;
}

interface RapierBody {
  translation(): RapierVector;
  rotation(): RapierRotation;
  linvel(): RapierVector;
  angvel(): RapierVector;
  setNextKinematicTranslation(translation: RapierVector): void;
}

interface RapierColliderDesc {
  setDensity(density: number): RapierColliderDesc;
}

interface RapierBodyDesc {
  setTranslation(x: number, y: number, z: number): RapierBodyDesc;
  setRotation(rotation: RapierRotation): RapierBodyDesc;
  setLinvel(x: number, y: number, z: number): RapierBodyDesc;
}

interface RapierWorld {
  timestep: number;
  step(): void;
  free(): void;
  createRigidBody(description: RapierBodyDesc): RapierBody;
  createCollider(description: RapierColliderDesc, parent: RapierBody): unknown;
  removeRigidBody(body: RapierBody): void;
}

interface RapierModule {
  init(): Promise<void>;
  World: new (gravity: RapierVector) => RapierWorld;
  RigidBodyDesc: {
    dynamic(): RapierBodyDesc;
    fixed(): RapierBodyDesc;
    kinematicPositionBased(): RapierBodyDesc;
  };
  ColliderDesc: {
    cuboid(hx: number, hy: number, hz: number): RapierColliderDesc;
  };
}
