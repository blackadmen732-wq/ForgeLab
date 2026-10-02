import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Euler, Vector3 } from "three";
import type { CameraMode } from "../store/editor.js";
import { useEditorStore } from "../store/context.js";
import { HALL } from "./environment/hall/geometry.js";

/** Eye height of a standing person, m. */
export const EYE_HEIGHT_M = 1.7;
/** Walking pace and a brisk jog (Shift), m/s. */
const WALK_SPEED = [1.4, 5] as const;
/** Flying speed, slow and fast (Shift), m/s: crossing the hall takes seconds, not minutes. */
const FLY_SPEED = [6, 30] as const;
const LOOK_RAD_PER_PX = 0.0035;
const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

interface OrbitLike {
  readonly target: Vector3;
  update(): void;
}

/**
 * First-person camera for walking through a machine at human eye height, or flying round
 * it. Drag (either button) to look; W A S D / arrows to move, Q / E down and up when
 * flying, Shift to go faster, Esc back to orbit. Presentation only: moving the camera
 * never touches the design or the run.
 */
export function WalkControls({ mode }: { mode: CameraMode }) {
  const store = useEditorStore();
  const get = useThree((s) => s.get);

  useEffect(() => {
    if (mode === "orbit") return;
    const { camera, gl, invalidate } = get();
    const dom = gl.domElement;
    const held = new Set<string>();
    let fast = false;
    const look = new Vector3();
    camera.getWorldDirection(look);
    let yaw = Math.atan2(-look.x, -look.z);
    let pitch = Math.asin(Math.max(-1, Math.min(1, look.y)));
    const euler = new Euler(0, 0, 0, "YXZ");
    const orient = () => {
      camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0));
      camera.updateMatrixWorld();
      invalidate();
    };
    if (mode === "walk") {
      // Step down onto the floor in front of what the orbit camera was looking at, between
      // 6 and 25 m from it, facing it.
      const controls = get().controls as unknown as OrbitLike | null;
      if (controls !== null) {
        const target = controls.target;
        const away = new Vector3(camera.position.x - target.x, 0, camera.position.z - target.z);
        const distance = Math.max(6, Math.min(25, away.length()));
        if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
        away.normalize();
        camera.position.set(
          target.x + away.x * distance,
          EYE_HEIGHT_M,
          target.z + away.z * distance,
        );
        yaw = Math.atan2(away.x, away.z);
        pitch = Math.atan2(target.y - EYE_HEIGHT_M, distance);
      }
      camera.position.y = EYE_HEIGHT_M;
      pitch = Math.max(-0.6, Math.min(0.6, pitch));
    }
    orient();

    let dragging: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      dragging = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (dragging === null || e.buttons === 0) return;
      yaw -= (e.clientX - dragging.x) * LOOK_RAD_PER_PX;
      pitch = Math.max(-1.5, Math.min(1.5, pitch - (e.clientY - dragging.y) * LOOK_RAD_PER_PX));
      dragging = { x: e.clientX, y: e.clientY };
      orient();
    };
    const onUp = () => {
      dragging = null;
    };
    const onContext = (e: Event) => e.preventDefault();

    let frame = 0;
    let last = 0;
    const forward = new Vector3();
    const right = new Vector3();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const [slow, quick] = mode === "walk" ? WALK_SPEED : FLY_SPEED;
      const d = (fast ? quick : slow) * dt;
      // Walking moves on the floor; flying moves where you look.
      forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      if (mode === "fly")
        forward.set(
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        );
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const has = (...k: string[]) => k.some((x) => held.has(x));
      if (has("w", "arrowup")) camera.position.addScaledVector(forward, d);
      if (has("s", "arrowdown")) camera.position.addScaledVector(forward, -d);
      if (has("d", "arrowright")) camera.position.addScaledVector(right, d);
      if (has("a", "arrowleft")) camera.position.addScaledVector(right, -d);
      if (mode === "fly") {
        if (held.has("e")) camera.position.y += d;
        if (held.has("q")) camera.position.y -= d;
      }
      // Stay inside the hall; never below the floor.
      camera.position.x = Math.max(-HALL.halfX + 1, Math.min(HALL.halfX - 1, camera.position.x));
      camera.position.z = Math.max(-HALL.halfZ + 1, Math.min(HALL.halfZ - 1, camera.position.z));
      camera.position.y =
        mode === "walk" ? EYE_HEIGHT_M : Math.max(0.3, Math.min(HALL.eaveM - 1, camera.position.y));
      camera.updateMatrixWorld();
      invalidate();
      frame = held.size > 0 ? requestAnimationFrame(step) : 0;
    };
    // Capture phase, so movement keys never reach the builder's shortcuts while walking.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      fast = e.shiftKey;
      if (k === "escape") {
        e.stopPropagation();
        store.setCameraMode("orbit");
        return;
      }
      if (!MOVE_KEYS.has(k)) return;
      e.preventDefault();
      e.stopPropagation();
      held.add(k);
      if (frame === 0) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      fast = e.shiftKey;
      held.delete(e.key.toLowerCase());
    };
    const onBlur = () => held.clear();

    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(frame);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      // Hand back to orbit: target what you were looking at, never above the eye (orbit
      // keeps the camera above its target).
      // The orbit controls are the scene's default controls (makeDefault).
      const controls = get().controls as unknown as OrbitLike | null;
      if (controls !== null) {
        camera.getWorldDirection(look);
        const target = camera.position.clone().addScaledVector(look, 12);
        target.y = Math.min(target.y, camera.position.y - 0.05);
        controls.target.copy(target);
        controls.update();
      }
      invalidate();
    };
  }, [mode, get, store]);

  return null;
}
