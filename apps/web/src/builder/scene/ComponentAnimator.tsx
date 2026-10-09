import { useFrame } from "@react-three/fiber";
import { useContext, useRef } from "react";
import { Color, type MeshBasicMaterial, type ShaderMaterial } from "three";
import { PresentationContext } from "../../presentation/context.js";
import { motionAllowed, getSettings } from "../../presentation/settings.js";
import type { VisualState } from "../../presentation/visualState.js";
import { plasmaUnrest } from "./appearance.js";
import { meshRegistry } from "./meshes.js";
import { animatePlasma } from "./plasma.js";

/**
 * Spins rotors and lights status lamps from the director's per-machine visual state.
 * Rotor speed eases toward the machine's activity, so pumps spin up and coast down the
 * way the flow does; nothing here is fed back to the simulation.
 *
 * Also the visible precursors of a failure, each read from a published value: a pump that
 * is cavitating shudders in proportion to the head it has lost, and a plasma close to a
 * stability limit wobbles. They warn; they never decide.
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
/** Shudder of a pump that has lost all its head, m (readable, not a measured amplitude). */
const MAX_SHUDDER_M = 0.03;
const scratch = new Color();

export function ComponentAnimator() {
  const director = useContext(PresentationContext);
  const speeds = useRef(new Map<string, number>());
  const phases = useRef(new Map<string, string>());
  const flashAt = useRef(new Map<string, number>());
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
    const t = now / 1000;
    const parts = simulate ? state.reading?.components : undefined;
    for (const [id, handle] of meshRegistry) {
      const visual = simulate ? state.visuals.get(id) : undefined;
      // Precursors.
      const part = parts?.find((c) => c.id === id);
      const lost = part === undefined ? 0 : 1 - Math.min(1, Math.max(0, part.headFraction));
      if (lost > 0 && motion) {
        const a = MAX_SHUDDER_M * lost;
        handle.shake.position.set(
          a * Math.sin(t * 2 * Math.PI * 23) * Math.sin(t * 7.3),
          a * 0.5 * Math.sin(t * 2 * Math.PI * 31 + 1),
          a * Math.sin(t * 2 * Math.PI * 37 + 2) * Math.cos(t * 5.1),
        );
        moving = true;
      } else if (handle.shake.position.lengthSq() > 0) handle.shake.position.set(0, 0, 0);
      if (handle.glow !== null && handle.glow.visible) {
        // Filaments drift and the breakdown flash fades in presentation time.
        const phase = state.reading?.vessels[id]?.plasma.phase ?? "off";
        const before = phases.current.get(id);
        if (phase === "ramp-up" && before !== "ramp-up") flashAt.current.set(id, t);
        phases.current.set(id, phase);
        const since = t - (flashAt.current.get(id) ?? -Infinity);
        const flash = motion && since < 1.5 ? Math.exp(-since / 0.35) : 0;
        animatePlasma(handle.glow.material as ShaderMaterial, motion ? t : 0, flash);
        if (motion) moving = true;
      } else if (handle.glow !== null) phases.current.set(id, "off");
      if (handle.glow !== null) {
        const unrest = motion ? plasmaUnrest(state.reading?.vessels[id] ?? null) : 0;
        if (unrest > 0) {
          const w = 0.06 * unrest;
          handle.glow.scale.set(
            1 + w * Math.sin(t * 2 * Math.PI * 2.3),
            1 + w * Math.sin(t * 2 * Math.PI * 3.1 + 1),
            1 + w * Math.sin(t * 2 * Math.PI * 2.3 + 2),
          );
          moving = true;
        } else if (handle.glow.scale.x !== 1) handle.glow.scale.set(1, 1, 1);
      }
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
