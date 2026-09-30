import { useFrame } from "@react-three/fiber";
import { useContext, useRef } from "react";
import { Color, type MeshBasicMaterial } from "three";
import { PresentationContext } from "../../presentation/context.js";
import { motionAllowed, getSettings } from "../../presentation/settings.js";
import type { VisualState } from "../../presentation/visualState.js";
import { meshRegistry } from "./meshes.js";

/**
 * Spins rotors and lights status lamps from the director's per-machine visual state.
 * Rotor speed eases toward the machine's activity, so pumps spin up and coast down the
 * way the flow does; nothing here is fed back to the simulation.
 */
const LAMP: Readonly<Record<VisualState, { color: Color; blinkHz: number }>> = {
  OFF: { color: new Color("#23282e"), blinkHz: 0 },
  STARTING: { color: new Color("#ffb020"), blinkHz: 1 },
  RUNNING: { color: new Color("#33d17a"), blinkHz: 0 },
  HIGH_LOAD: { color: new Color("#5ad1c8"), blinkHz: 0 },
  WARNING: { color: new Color("#ffb020"), blinkHz: 0 },
  FAILING: { color: new Color("#ff3b30"), blinkHz: 2 },
  FAILED: { color: new Color("#ff3b30"), blinkHz: 0 },
  SHUTTING_DOWN: { color: new Color("#ffb020"), blinkHz: 0.5 },
};

/** Visual angular speed at full activity, rad/s (readable, not literal RPM). */
const MAX_SPIN = 14;
const scratch = new Color();

export function ComponentAnimator() {
  const director = useContext(PresentationContext);
  const speeds = useRef(new Map<string, number>());
  const last = useRef(0);

  useFrame(({ invalidate }) => {
    if (director === null) return;
    const now = performance.now();
    const dt = last.current === 0 ? 0 : Math.min(0.1, (now - last.current) / 1000);
    last.current = now;
    const state = director.getState();
    const simulate = state.mode === "simulate";
    const reduced = getSettings().reducedEffects;
    const motion = motionAllowed();
    let moving = false;
    for (const [id, handle] of meshRegistry) {
      const visual = simulate ? state.visuals.get(id) : undefined;
      if (handle.lamp !== null) {
        handle.lamp.visible = simulate;
        if (visual !== undefined) {
          const look = LAMP[visual.state];
          const on =
            look.blinkHz === 0 || reduced || Math.floor((now / 1000) * look.blinkHz * 2) % 2 === 0;
          (handle.lamp.material as MeshBasicMaterial).color.copy(
            scratch.copy(look.color).multiplyScalar(on ? 1.8 : 0.25),
          );
          if (look.blinkHz > 0 && !reduced) moving = true;
        }
      }
      if (handle.rotor === null) continue;
      const target = visual === undefined || !motion ? 0 : visual.activity * MAX_SPIN;
      const current = speeds.current.get(id) ?? 0;
      // Spin-up is quicker than coast-down, like a motor against a flywheel.
      const rate = target > current ? 1.5 : 0.6;
      const next = current + (target - current) * Math.min(1, dt * rate);
      const speed = Math.abs(next) < 0.01 && target === 0 ? 0 : next;
      speeds.current.set(id, speed);
      if (speed !== 0) {
        handle.rotor.rotation[handle.rotorAxis] += speed * dt;
        moving = true;
      }
    }
    if (moving) invalidate();
  });
  return null;
}
