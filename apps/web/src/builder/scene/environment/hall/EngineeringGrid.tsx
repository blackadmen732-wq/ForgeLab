import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  DoubleSide,
  type Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { gridLabelTexture } from "../textures.js";
import { HALL } from "./geometry.js";

/**
 * The engineering grid painted into the build zone: 1 m, 5 m and 10 m lines with
 * screen-space anti-aliasing, fading with distance (minor lines first) and at the zone
 * edges, plus axis numbering every 10 m. A measuring aid only — it has no snapping or
 * physical meaning of its own.
 */
const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uCamera;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  uniform vec2 uHalf;
  uniform float uOpacity;
  varying vec3 vWorld;

  float line(vec2 p, float spacing, float width) {
    vec2 c = p / spacing;
    vec2 d = fwidth(c);
    vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, vec2(1e-4));
    return 1.0 - min(min(g.x, g.y) / width, 1.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    float dist = distance(uCamera, vWorld);
    float minor = line(p, 1.0, 1.0) * (1.0 - smoothstep(8.0, 40.0, dist));
    float mid = line(p, 5.0, 1.15) * (1.0 - smoothstep(30.0, 140.0, dist));
    float major = line(p, 10.0, 1.5) * (1.0 - smoothstep(60.0, 240.0, dist));
    vec2 edge = smoothstep(uHalf + 0.5, uHalf - 1.5, abs(p));
    float inside = edge.x * edge.y;
    float a = max(max(minor * 0.1, mid * 0.2), major * 0.34) * inside * uOpacity;
    if (a < 0.003) discard;
    vec3 color = mix(uMinor, uMajor, max(mid * 0.5, major));
    gl_FragColor = vec4(color, a);
  }
`;

export function EngineeringGrid({ dim = false }: { dim?: boolean }) {
  const halfX = HALL.buildHalfX;
  const halfZ = HALL.buildHalfZ;
  const plane = useMemo(
    () => new PlaneGeometry(2 * halfX + 2, 2 * halfZ + 2).rotateX(-Math.PI / 2),
    [halfX, halfZ],
  );
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        uniforms: {
          uCamera: { value: new Vector3() },
          uMinor: { value: new Vector3(0.55, 0.62, 0.7) },
          uMajor: { value: new Vector3(0.78, 0.86, 0.94) },
          uHalf: { value: new Vector2(halfX, halfZ) },
          uOpacity: { value: 1 },
        },
      }),
    [halfX, halfZ],
  );
  const labelsW = 2 * halfX + 10;
  const labelsD = 2 * halfZ + 10;
  const labels = useMemo(() => {
    const map = gridLabelTexture(labelsW, labelsD, halfX, halfZ);
    return {
      geometry: new PlaneGeometry(labelsW, labelsD).rotateX(-Math.PI / 2),
      material: new MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    };
  }, [labelsW, labelsD, halfX, halfZ]);
  useLayoutEffect(
    () => () => {
      plane.dispose();
      material.dispose();
      labels.geometry.dispose();
      labels.material.map?.dispose();
      labels.material.dispose();
    },
    [plane, material, labels],
  );
  const gridRef = useRef<Mesh>(null);
  const labelsRef = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const grid = gridRef.current?.material as ShaderMaterial | undefined;
    const text = labelsRef.current?.material as MeshBasicMaterial | undefined;
    if (grid === undefined || text === undefined) return;
    (grid.uniforms["uCamera"]!.value as Vector3).copy(camera.position);
    grid.uniforms["uOpacity"]!.value = dim ? 0.45 : 1;
    text.opacity = dim ? 0.25 : 0.55;
  });
  return (
    <group position={[0, 0.015, 0]}>
      <mesh ref={gridRef} geometry={plane} material={material} renderOrder={1} />
      <mesh ref={labelsRef} geometry={labels.geometry} material={labels.material} renderOrder={1} />
    </group>
  );
}
