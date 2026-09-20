import { QuaternionMath, Vec3Math, quaternion, transform, vec3 } from "@forgelab/shared";
import type { ComponentId, PhysicalProperties } from "../component.js";
import { worldBottomY } from "../geometry.js";
import type { DynamicsBackend, DynamicsStepContext, DynamicsStepResult } from "./backend.js";

/**
 * ForgeLab's own integrator: the default, and the one every determinism test runs against.
 *
 * Integration is semi-implicit (symplectic) Euler at a fixed step:
 *     v(t+dt) = v(t) + a * dt
 *     x(t+dt) = x(t) + v(t+dt) * dt
 * chosen over explicit Euler because it does not inject energy over long runs, and over
 * RK4 because a uniform gravitational field has no need of it.
 *
 * DOCUMENTED APPROXIMATIONS
 *  - A component the structural solver reports as held (anchored, grounded or supported)
 *    is held exactly: its velocity is zeroed and it does not move. There is no elastic
 *    deflection under load.
 *  - Ground contact is perfectly inelastic and frictionless: a falling body stops dead
 *    when its bounding box reaches the ground plane. No restitution, no sliding, no
 *    toppling.
 *  - Falling bodies do not collide with each other. That is exactly the gap the optional
 *    Rapier backend fills.
 *  - Rotation integrates from angular velocity, but nothing in Phase 0 produces torque,
 *    so it only moves if a caller sets an angular velocity itself.
 */
export class BuiltInDynamicsBackend implements DynamicsBackend {
  readonly id = "forgelab-builtin";

  step(context: DynamicsStepContext): DynamicsStepResult {
    const { fixedTimestepSec: dt, gravityAccelerationMps2: g, settings } = context;
    const updates = new Map<ComponentId, PhysicalProperties>();

    for (const component of context.components) {
      const physical = component.state.physical;
      const held = component.state.support.mode !== "free";

      if (held) {
        if (
          Vec3Math.equals(physical.linearVelocityMps, Vec3Math.VEC3_ZERO) &&
          Vec3Math.equals(physical.angularVelocityRadPerSec, Vec3Math.VEC3_ZERO)
        ) {
          continue;
        }
        updates.set(component.id, {
          ...physical,
          linearVelocityMps: Vec3Math.VEC3_ZERO,
          angularVelocityRadPerSec: Vec3Math.VEC3_ZERO,
        });
        continue;
      }

      const velocity = Vec3Math.add(physical.linearVelocityMps, Vec3Math.scale(g, dt));
      let position = Vec3Math.add(physical.positionM, Vec3Math.scale(velocity, dt));
      let settledVelocity = velocity;

      const candidate = transform(position, physical.rotation);
      const bottomY = worldBottomY(component.geometry, candidate);
      if (bottomY < settings.groundLevelM) {
        position = vec3(position.x, position.y + (settings.groundLevelM - bottomY), position.z);
        settledVelocity = vec3(velocity.x, 0, velocity.z);
      }

      updates.set(component.id, {
        ...physical,
        positionM: position,
        linearVelocityMps: settledVelocity,
        rotation: integrateRotation(physical.rotation, physical.angularVelocityRadPerSec, dt),
      });
    }

    return updates;
  }
}

/** q(t+dt) = normalize(q + 0.5 * omega_quat * q * dt), the standard first-order form. */
function integrateRotation(
  rotation: Parameters<typeof QuaternionMath.multiply>[0],
  angularVelocityRadPerSec: ReturnType<typeof vec3>,
  dt: number,
) {
  const w = angularVelocityRadPerSec;
  if (w.x === 0 && w.y === 0 && w.z === 0) return rotation;

  const omega = quaternion(w.x, w.y, w.z, 0);
  const derivative = QuaternionMath.multiply(omega, rotation);
  const half = 0.5 * dt;
  return QuaternionMath.normalize(
    quaternion(
      rotation.x + derivative.x * half,
      rotation.y + derivative.y * half,
      rotation.z + derivative.z * half,
      rotation.w + derivative.w * half,
    ),
  );
}
