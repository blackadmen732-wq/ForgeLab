import { useFrame, useThree } from "@react-three/fiber";
import { useContext, useEffect, useLayoutEffect, useMemo } from "react";
import type { PerspectiveCamera } from "three";
import { AudioEngineContext, CinemaContext, PresentationContext } from "../context.js";
import { tierBudget, useSettings } from "../settings.js";
import { VfxRuntime } from "./runtime.js";

/**
 * Scene host for the destruction effects runtime (runtime.ts): creates it for the current
 * quality tier, connects it to the presentation director and runs it every frame.
 */
export function VfxLayer() {
  const director = useContext(PresentationContext);
  const audio = useContext(AudioEngineContext);
  const cinema = useContext(CinemaContext);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const budget = tierBudget(useSettings());
  const runtime = useMemo(() => new VfxRuntime(budget), [budget]);
  useLayoutEffect(() => () => runtime.dispose(), [runtime]);
  const scene = useThree((s) => s.scene);
  useEffect(() => runtime.prewarm(gl, camera, scene), [runtime, gl, camera, scene]);
  const fov = (camera as PerspectiveCamera).fov ?? 45;
  useLayoutEffect(() => {
    const scale = size.height / (2 * Math.tan((fov * Math.PI) / 360));
    runtime.setScale(scale * gl.getPixelRatio());
  }, [runtime, size.height, fov, gl]);
  useEffect(() => {
    if (director === null) return;
    runtime.setTimeScale(() => cinema?.timeScale() ?? 1);
    return runtime.connect(director, audio, camera, invalidate);
  }, [runtime, director, audio, cinema, camera, invalidate]);
  // Restore the camera before the orbit controls read it (drei updates them at −1).
  useFrame(() => runtime.restoreCamera(camera), -2);
  useFrame((state) => runtime.frame(state));
  return <primitive object={runtime.root} />;
}
