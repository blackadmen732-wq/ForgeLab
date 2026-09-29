import { Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { type DirectionalLight, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HALL, IndustrialHall } from "./IndustrialHall.js";
import { useEnvironment } from "./presets.js";

/**
 * The space around the plant: background, fog, lighting and surroundings for the chosen
 * preset. Presentation only — see presets.ts.
 */
export function Environment({ showGrid }: { showGrid: boolean }) {
  const preset = useEnvironment();
  const key = useRef<DirectionalLight>(null);
  const hall = preset.scene === "hall";
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  useLayoutEffect(() => {
    get().scene.environmentIntensity = preset.light.reflections;
  }, [get, preset]);
  // Image-based lighting generated on the GPU from a procedural room: gives metal surfaces
  // something to reflect without downloading an HDR.
  const reflections = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return texture;
  }, [gl]);
  useLayoutEffect(() => () => reflections.dispose(), [reflections]);

  useLayoutEffect(() => {
    const light = key.current;
    if (light === null) return;
    const s = light.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.left = -HALL.halfX - 10;
    s.camera.right = HALL.halfX + 10;
    s.camera.top = HALL.halfZ + 30;
    s.camera.bottom = -HALL.halfZ - 30;
    s.camera.near = 1;
    s.camera.far = 320;
    s.bias = -0.0004;
    s.normalBias = 0.04;
    s.camera.updateProjectionMatrix();
    light.target.position.set(0, 0, 0);
    light.target.updateMatrixWorld();
  }, []);

  return (
    <>
      <color attach="background" args={[preset.background]} />
      <primitive attach="environment" object={reflections} />
      <fog attach="fog" args={[preset.fog.color, preset.fog.near, preset.fog.far]} />
      <hemisphereLight args={[preset.light.sky, preset.light.ground, preset.light.hemisphere]} />
      <directionalLight
        ref={key}
        position={[-60, 100, 30]}
        intensity={preset.light.key}
        color={preset.light.keyColor}
        castShadow={hall}
      />
      <directionalLight position={[70, 45, 60]} intensity={preset.light.fill} />
      {hall && <IndustrialHall preset={preset} />}
      {(showGrid || !hall) && (
        <Grid
          infiniteGrid={!hall}
          {...(hall ? { args: [80, 58] as [number, number] } : {})}
          cellSize={1}
          sectionSize={hall ? 6 : 10}
          cellThickness={0.5}
          sectionThickness={hall ? 0.8 : 1}
          cellColor={hall ? "#3a4450" : "#1a2027"}
          sectionColor={hall ? "#56616e" : "#27303a"}
          fadeDistance={hall ? 120 : 900}
          fadeStrength={1.5}
          followCamera={false}
          position={[0, hall ? 0.02 : -0.002, 0]}
        />
      )}
    </>
  );
}
