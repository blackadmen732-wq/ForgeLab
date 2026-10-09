import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import { Vector2 } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { tierBudget, useSettings } from "./settings.js";

/**
 * Post-processing: bloom on genuinely bright things (fixtures, plasma, arcs, sparks,
 * flashes) and a restrained vignette, then tone mapping. Only when the quality tier and
 * the viewer allow it; otherwise the scene renders directly. Drawing only.
 */
export function PostFx() {
  const settings = useSettings();
  const enabled = settings.bloom && tierBudget(settings).bloom;
  return enabled ? <Composer /> : null;
}

function Composer() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new Vector2(size.width, size.height), 0.55, 0.45, 0.9));
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms["offset"]!.value = 1.05;
    vignette.uniforms["darkness"]!.value = 0.85;
    c.addPass(vignette);
    c.addPass(new OutputPass());
    return c;
    // The composer is rebuilt when the renderer, scene or camera changes; size is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);
  useLayoutEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size.width, size.height]);
  useLayoutEffect(() => () => composer.dispose(), [composer]);
  // Priority 1: this frame callback renders instead of the default render.
  useFrame(() => composer.render(), 1);
  return null;
}
