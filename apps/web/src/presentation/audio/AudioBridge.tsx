import { useFrame } from "@react-three/fiber";
import { useContext } from "react";
import { Vector3 } from "three";
import { meshRegistry } from "../../builder/scene/meshes.js";
import { AudioEngineContext } from "../context.js";

const forward = new Vector3();
const up = new Vector3();
const world = new Vector3();

/**
 * Places the audio listener at the camera and each machine's emitter at its mesh, so
 * sound pans and fades as the viewer moves through the hall.
 */
export function AudioBridge() {
  const engine = useContext(AudioEngineContext);
  useFrame(({ camera }) => {
    if (engine === null || !engine.running) return;
    camera.getWorldDirection(forward);
    up.copy(camera.up).applyQuaternion(camera.quaternion);
    engine.setListener(
      [camera.position.x, camera.position.y, camera.position.z],
      [forward.x, forward.y, forward.z],
      [up.x, up.y, up.z],
    );
    for (const id of engine.emitterIds()) {
      const handle = meshRegistry.get(id);
      if (handle === undefined) continue;
      handle.group.getWorldPosition(world);
      engine.setEmitterPosition(id, world.x, world.y, world.z);
    }
  });
  return null;
}
