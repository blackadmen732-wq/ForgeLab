import { useFrame } from "@react-three/fiber";
import { useContext, useEffect, useRef } from "react";
import { Vector3 } from "three";
import { meshRegistry } from "../builder/scene/meshes.js";
import { useEditorStore } from "../builder/store/context.js";
import { CinemaContext } from "./context.js";

const target = new Vector3();

/**
 * Advances the failure-cinema playhead every frame and, in follow mode, keeps the orbit
 * target on the part being watched (it may be falling). Root-cause mode frames the part
 * that failed first.
 */
export function CinemaDriver() {
  const cinema = useContext(CinemaContext);
  const store = useEditorStore();
  const last = useRef(0);
  const framedFor = useRef<string | null>(null);

  useEffect(() => {
    if (cinema === null) return;
    return cinema.subscribe(() => {
      const s = cinema.getState();
      if (!s.active) {
        framedFor.current = null;
        return;
      }
      if (s.camera === "root" && s.rootId !== null && framedFor.current !== s.rootId) {
        framedFor.current = s.rootId;
        store.requestFrame([s.rootId]);
      }
      if (s.camera !== "root") framedFor.current = null;
    });
  }, [cinema, store]);

  useFrame((state) => {
    const now = performance.now();
    const dt = last.current === 0 ? 0 : Math.min(0.1, (now - last.current) / 1000);
    last.current = now;
    if (cinema === null) return;
    const s = cinema.getState();
    if (!s.active) return;
    cinema.advance(dt);
    if (s.camera === "follow" && s.focusId !== null) {
      const handle = meshRegistry.get(s.focusId);
      const controls = state.controls as unknown as { target: Vector3; update(): void } | null;
      if (handle !== undefined && controls !== null) {
        handle.group.getWorldPosition(target);
        controls.target.lerp(target, Math.min(1, dt * 2.5));
        controls.update();
      }
    }
    if (s.playing || s.camera === "follow") state.invalidate();
  });
  return null;
}
