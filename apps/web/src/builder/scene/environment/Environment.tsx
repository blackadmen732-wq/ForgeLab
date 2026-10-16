import { Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type DirectionalLight, type HemisphereLight, PMREMGenerator, type Texture } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { useAssetManifest } from "../../../lib/assets.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { tierBudget, useSettings } from "../../../presentation/settings.js";
import { EngineeringGrid } from "./hall/EngineeringGrid.js";
import { HALL_LIGHT_NAMES, MainReactorHall } from "./hall/MainReactorHall.js";
import { useEnvironment } from "./presets.js";
import { hallReflections } from "./reflections.js";

/**
 * The space around the plant: background, haze, lighting and surroundings for the chosen
 * preset. Presentation only — see presets.ts. Quality settings change shadow resolution
 * and haze here; they never reach the simulation.
 */
export function Environment({
  showGrid,
  dimGrid = false,
}: {
  showGrid: boolean;
  dimGrid?: boolean;
}) {
  const preset = useEnvironment();
  const settings = useSettings();
  const budget = tierBudget(settings);
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const hemisphere = useRef<HemisphereLight>(null);
  const hall = preset.scene === "hall";
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  useLayoutEffect(() => {
    get().scene.environmentIntensity = preset.light.reflections;
  }, [get, preset]);
  // Image-based lighting generated on the GPU: inside the hall, metal reflects the hall's
  // own lamps and clerestory; elsewhere a neutral procedural room. No HDR download.
  const dark = preset.id === "dark-facility";
  const reflections = useMemo(() => {
    if (hall) return hallReflections(gl, dark);
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return texture;
  }, [gl, hall, dark]);
  useLayoutEffect(() => () => reflections.dispose(), [reflections]);
  // A photographed power-plant interior from the asset bucket, when one is configured:
  // metal then reflects a real hall. Until it loads (or without a bucket), the procedural
  // map above is used.
  const manifest = useAssetManifest();
  const hdriUrl = hall ? (manifest?.hdri["hall-hdri"]?.url ?? null) : null;
  const [photo, setPhoto] = useState<{ url: string; texture: Texture } | null>(null);
  useEffect(() => {
    if (hdriUrl === null) return;
    let cancelled = false;
    new HDRLoader().load(
      hdriUrl,
      (equirect) => {
        const pmrem = new PMREMGenerator(gl);
        const texture = pmrem.fromEquirectangular(equirect).texture;
        pmrem.dispose();
        equirect.dispose();
        if (cancelled) texture.dispose();
        else setPhoto({ url: hdriUrl, texture });
      },
      undefined,
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [gl, hdriUrl]);
  useEffect(() => () => photo?.texture.dispose(), [photo]);
  const environment = photo !== null && photo.url === hdriUrl ? photo.texture : reflections;

  useLayoutEffect(() => {
    const light = key.current;
    if (light === null) return;
    const s = light.shadow;
    if (s.mapSize.x !== budget.shadowMapSize) {
      s.mapSize.set(budget.shadowMapSize, budget.shadowMapSize);
      s.map?.dispose();
      s.map = null;
    }
    // PlantShadows fits the projection and bias to the rendered assembly.
    s.needsUpdate = true;
    get().gl.shadowMap.needsUpdate = true;
  }, [budget.shadowMapSize, get]);

  const haze = hall && settings.haze && budget.haze;
  const fogNear = haze ? preset.fog.near * 0.7 : preset.fog.near;
  const fogFar = haze ? preset.fog.far * 0.75 : preset.fog.far;

  return (
    <>
      <color attach="background" args={[preset.background]} />
      <primitive attach="environment" object={environment} />
      <fog attach="fog" args={[preset.fog.color, fogNear, fogFar]} />
      <hemisphereLight
        ref={hemisphere}
        name={HALL_LIGHT_NAMES.hemisphere}
        args={[preset.light.sky, preset.light.ground, preset.light.hemisphere]}
      />
      <directionalLight
        ref={key}
        name={HALL_LIGHT_NAMES.key}
        position={[-35, 110, 25]}
        intensity={preset.light.key}
        color={preset.light.keyColor}
        castShadow={hall}
      />
      <directionalLight
        ref={fill}
        name={HALL_LIGHT_NAMES.fill}
        position={[70, 45, 60]}
        intensity={preset.light.fill}
        color={preset.light.fillColor}
      />
      {hall && <MainReactorHall preset={preset} />}
      {hall && showGrid && <EngineeringGrid dim={dimGrid} />}
      {!hall && (
        <Grid
          infiniteGrid
          cellSize={1}
          sectionSize={10}
          cellThickness={0.5}
          sectionThickness={1}
          cellColor="#1a2027"
          sectionColor="#27303a"
          fadeDistance={900}
          fadeStrength={1.5}
          followCamera={false}
          position={[0, -0.002, 0]}
        />
      )}
    </>
  );
}
