import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Box3, type DirectionalLight, Matrix4, Vector3 } from "three";
import { geometryLocalHalfExtentsM } from "@forgelab/sim-core";
import { useEditorStore } from "../../store/context.js";
import { tierBudget, useSettings } from "../../../presentation/settings.js";
import { meshRegistry } from "../meshes.js";
import { HALL_LIGHT_NAMES } from "./hall/MainReactorHall.js";
import { useEnvironment } from "./presets.js";
import { fitPlantShadow, includeVisibleFloor } from "./shadows.js";
import { HALL } from "./hall/geometry.js";

const bounds = new Box3();
const corner = new Vector3();

/** Runs after the appearance driver has applied live, dragged and exploded transforms. */
export function PlantShadows() {
  const store = useEditorStore();
  const get = useThree((s) => s.get);
  const preset = useEnvironment();
  const mapSize = tierBudget(useSettings()).shadowMapSize;
  const dirty = useRef(true);
  const lastCamera = useRef(new Matrix4());
  const lastProjection = useRef(new Matrix4());
  useEffect(() => {
    dirty.current = true;
    const mark = () => {
      dirty.current = true;
    };
    const a = store.subscribe(mark);
    const b = store.subscribeSim(mark);
    return () => {
      a();
      b();
    };
  }, [store, preset, mapSize]);

  useFrame(() => {
    const { gl, scene, camera } = get();
    camera.updateMatrixWorld();
    const cameraChanged =
      !lastCamera.current.equals(camera.matrixWorld) ||
      !lastProjection.current.equals(camera.projectionMatrix);
    // Gizmo drags and inspection may invalidate the shadow map without publishing a run.
    if (preset.scene !== "hall" || (!dirty.current && !gl.shadowMap.needsUpdate && !cameraChanged))
      return;
    const light = scene.getObjectByName(HALL_LIGHT_NAMES.key) as DirectionalLight | undefined;
    if (light === undefined) return;
    dirty.current = false;
    lastCamera.current.copy(camera.matrixWorld);
    lastProjection.current.copy(camera.projectionMatrix);
    bounds.makeEmpty();
    for (const c of store.getView().snapshot.components) {
      const handle = meshRegistry.get(c.id);
      if (handle === undefined || !handle.group.visible) continue;
      const h = geometryLocalHalfExtentsM(c.geometry);
      handle.group.updateWorldMatrix(true, false);
      for (let i = 0; i < 8; i += 1) {
        corner.set(i & 1 ? h.x : -h.x, i & 2 ? h.y : -h.y, i & 4 ? h.z : -h.z);
        bounds.expandByPoint(corner.applyMatrix4(handle.group.matrixWorld));
      }
    }
    // A small empty workspace still shows the crane and a useful patch of floor shadow.
    if (bounds.isEmpty()) bounds.set(new Vector3(-16, 0, -16), new Vector3(16, 12, 16));
    includeVisibleFloor(bounds, camera, HALL.halfX, HALL.halfZ);
    fitPlantShadow(light, bounds, mapSize);
    gl.shadowMap.needsUpdate = true;
  });
  return null;
}
