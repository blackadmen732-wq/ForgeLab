import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from "three";
import type { VesselState } from "@forgelab/sim-core";

/**
 * The plasma as drawn: presentation of the published plasma state, never a source of it.
 *
 * What it shows, and why:
 * - **Edge glow.** The highly ionized core has weak visible continuum, not a liquid
 *   surface. Cooler edge neutrals and impurities contribute visible line emission.
 *   Hydrogen Balmer lines motivate this palette; camera filters/exposure change colour.
 *   Looking through the edge layer side-on gives a longer
 *   path through it, so the rim of the torus is brighter than its face (limb brightening).
 * - **Filaments along field lines.** Edge filaments are stretched along the magnetic field,
 *   which winds once poloidally every q95 turns toroidally; the striations follow that
 *   pitch, taken from the published safety factor. Straight devices (linear) have straight
 *   field lines, so their striations run along the axis.
 * - **Brightness** follows the published density (more particles, more edge light) and
 *   the phase: dark when off or ended, a breakdown flash on ramp-up. Shutdown dims only
 *   as published density falls; this is not a calculated emissivity or temperature map.
 * The geometry is the vessel's interior, not a computed plasma boundary (the plasma model is
 * 0-D): shape is SCHEMATIC, colour and pitch are physically motivated, nothing is measured.
 */

/** Poloidal striations drawn around the minor circumference. */
const STRIPES = 24;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uFlash;
  uniform float uTwist;
  uniform float uToroidal;
  uniform vec3 uEdge;
  uniform vec3 uCore;
  // Value noise on a lattice that repeats every (px, py) cells, so the pattern closes
  // around the torus without a seam.
  float hash(vec2 p, vec2 period) {
    p = mod(p, period);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p, vec2 period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i, period), hash(i + vec2(1.0, 0.0), period), u.x),
               mix(hash(i + vec2(0.0, 1.0), period), hash(i + vec2(1.0, 1.0), period), u.x), u.y);
  }
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    // Thin emitting layer: bounded path-length enhancement at grazing angles. A faint
    // face leaves the interior readable instead of filling it with an opaque neon skin.
    float limb = pow(1.0 - facing, 2.4);
    // Coordinate across the field (which filament) and along it.
    float across = uToroidal > 0.5 ? vUv.y * ${STRIPES}.0 - vUv.x * uTwist : vUv.x * ${STRIPES}.0;
    float along = uToroidal > 0.5 ? vUv.x : vUv.y;
    vec2 period = vec2(${STRIPES}.0, 48.0);
    float f1 = noise(vec2(across + uTime * 0.35, along * 48.0 - uTime * 1.5), period);
    float f2 = noise(vec2(across * 2.0 - uTime * 0.2, along * 48.0 + uTime * 0.9), period * vec2(2.0, 1.0));
    float filaments = smoothstep(0.63, 0.94, f1) * 0.65 + smoothstep(0.72, 0.98, f2) * 0.3;
    float edgeCloud = 0.72 + 0.28 * noise(vec2(across, along * 48.0 + uTime * 0.25), period);
    vec3 colour = mix(uCore, uEdge, 0.45 + 0.55 * limb);
    colour = mix(colour, vec3(1.0, 0.8, 0.9), filaments * 0.2 + uFlash * 0.35);
    float emission = uIntensity * ((0.025 + 0.55 * limb) * edgeCloud +
                                  0.22 * filaments * (0.15 + limb) + uFlash * 0.32);
    // SrcAlpha/One additive blending applies opacity once. Do not pre-multiply here.
    gl_FragColor = vec4(colour, clamp(emission, 0.0, 0.85));
    #include <colorspace_fragment>
  }
`;

export function createPlasmaMaterial(toroidal: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uFlash: { value: 0 },
      uTwist: { value: Math.round(STRIPES / 3) },
      uToroidal: { value: toroidal ? 1 : 0 },
      // Balmer-α pink at the edge, a violet-blue hint (Balmer-β/γ) toward the face.
      uEdge: { value: new Color("#f878a8") },
      uCore: { value: new Color("#7476c9") },
    },
  });
}

/**
 * Brightness 0..1 of the edge light from the published state: zero without a plasma,
 * rising with density over the 10¹⁸–10²⁰ m⁻³ range of real devices (log scale).
 */
export function plasmaBrightness(vessel: VesselState | null): number {
  if (vessel === null) return 0;
  const p = vessel.plasma;
  if (p.phase !== "ramp-up" && p.phase !== "flat-top" && p.phase !== "shutdown") return 0;
  if (!Number.isFinite(p.densityM3) || p.densityM3 <= 0) return 0;
  if (p.densityM3 < 1e18) return 0.3 * (p.densityM3 / 1e18);
  const decades = Math.log10(p.densityM3 / 1e18) / 2;
  return 0.3 + 0.7 * Math.min(1, Math.max(0, decades));
}

/**
 * Filament twist per toroidal turn, as a whole number of stripes so the pattern closes
 * around the torus: a field line advances 1/q95 of a poloidal turn per toroidal turn.
 */
export function filamentTwist(vessel: VesselState | null): number {
  const q = vessel?.plasma.safetyFactorQ95 ?? NaN;
  if (!Number.isFinite(q) || q <= 0) return Math.round(STRIPES / 3);
  return Math.round(STRIPES / q);
}

/** Pushes the published state into the material (called when the frame changes). */
export function applyPlasmaState(material: ShaderMaterial, vessel: VesselState | null): number {
  const brightness = plasmaBrightness(vessel);
  material.uniforms["uIntensity"]!.value = brightness;
  material.uniforms["uTwist"]!.value = filamentTwist(vessel);
  if (brightness === 0) material.uniforms["uFlash"]!.value = 0;
  return brightness;
}

/** Advances the filament motion and the breakdown flash (presentation time). */
export function animatePlasma(material: ShaderMaterial, timeS: number, flash: number): void {
  material.uniforms["uTime"]!.value = timeS;
  material.uniforms["uFlash"]!.value =
    material.uniforms["uIntensity"]!.value > 0 && Number.isFinite(flash)
      ? Math.min(1, Math.max(0, flash))
      : 0;
}
