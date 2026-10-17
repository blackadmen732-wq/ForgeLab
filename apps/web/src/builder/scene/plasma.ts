import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector3 } from "three";
import type { ComponentGeometry, VesselState } from "@forgelab/sim-core";

/**
 * The plasma as drawn: presentation of the published plasma state, never a source of it.
 *
 * What it shows, and why:
 * - **Edge glow.** The highly ionized core has weak visible continuum, not a liquid
 *   surface. Cooler edge neutrals and impurities contribute visible line emission.
 *   Hydrogen Balmer lines motivate this palette; camera filters/exposure change colour.
 *   A short, bounded ray integration through a soft emitting edge avoids a solid skin.
 *   This is an artistic optical cue, not a radiative-transfer or emissivity solver.
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
  uniform float uAxis;
  varying vec3 vLocal;
  varying vec3 vEye;
  // Canonical optical volume has its symmetry axis along z, regardless of vessel axis.
  vec3 canonical(vec3 p) {
    if (uAxis < 0.5) return p.zyx;
    if (uAxis < 1.5) return p.xzy;
    return p;
  }
  void main() {
    vLocal = canonical(position);
    vEye = canonical((inverse(modelViewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vEye;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uFlash;
  uniform float uTwist;
  uniform float uToroidal;
  uniform vec3 uEdge;
  uniform vec3 uCore;
  // major radius, minor radius, cylinder half-length; matches the existing glow envelope.
  uniform vec3 uShape;
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
  vec2 crossSection(vec3 p) {
    return uToroidal > 0.5 ? vec2(length(p.xy) - uShape.x, p.z) : p.xy;
  }
  float radiusAt(vec3 p) {
    float radial = length(crossSection(p)) / uShape.y;
    return uToroidal > 0.5 ? radial : max(radial, abs(p.z) / uShape.z);
  }
  void main() {
    if (uIntensity <= 0.0) discard;
    bool inside = radiusAt(vEye) < 1.0;
    // One integration per connected interval, including when the camera enters the volume.
    // Two-sided surface emission would count both faces and produce a hard bright rim.
    if (gl_FrontFacing == inside) discard;
    vec3 direction = normalize(vLocal - vEye);
    vec3 start = inside ? vEye : vLocal;
    float stepM = uShape.y * 0.22;
    vec3 light = vec3(0.0);
    // Fixed upper bound, no extra meshes/textures/particles. Stop at the first exit rather
    // than integrating another torus segment that will draw through its own entry face.
    for (int i = 0; i < 24; i++) {
      vec3 p = start + direction * (float(i) + 0.5) * stepM;
      float rho = radiusAt(p);
      if (rho > 1.02) break;
      vec2 section = crossSection(p);
      float around = atan(p.y, p.x) / 6.2831853 + 0.5;
      float poloidal = atan(section.y, section.x) / 6.2831853 + 0.5;
      float along = uToroidal > 0.5 ? around : p.z / (2.0 * uShape.z) + 0.5;
      float across = (uToroidal > 0.5 ? poloidal : around) * ${STRIPES}.0 - along * uTwist;
      vec2 period = vec2(${STRIPES}.0, 48.0);
      float cloud = noise(vec2(across + uTime * 0.18, along * 48.0 - uTime * 0.6), period);
      float detail = noise(vec2(across * 2.0 - uTime * 0.15, along * 96.0), period * 2.0);
      float filaments = smoothstep(0.64, 0.94, cloud * 0.7 + detail * 0.3);
      // The edge is a broad internal layer, fading out before the envelope. Nothing
      // emits from the polygon surface, and the interior continuum stays much fainter.
      float edge = exp(-pow((rho - 0.76) / 0.16, 2.0));
      float envelope = 1.0 - smoothstep(0.86, 1.0, rho);
      float emission = envelope * (0.012 + edge * (0.12 + cloud * 0.13 + filaments * 0.55));
      vec3 colour = mix(uCore, uEdge, clamp(edge * 0.85, 0.0, 1.0));
      light += colour * emission * 0.22;
    }
    light *= uIntensity * (1.0 + uFlash * 0.55);
    // Keep integrated strength in alpha. Converting a very faint RGB radiance to sRGB
    // before additive blending lifts its dark values and blows out a bright background.
    // This bounded display mapping is illustrative, not calibrated camera exposure.
    float energy = max(light.r, max(light.g, light.b));
    gl_FragColor = vec4(light / max(energy, 0.00001), min(0.24, energy * 0.55));
    #include <colorspace_fragment>
  }
`;

export function createPlasmaMaterial(
  toroidal: boolean,
  geometry?: ComponentGeometry,
): ShaderMaterial {
  const axis = geometry !== undefined && "axis" in geometry ? geometry.axis : "z";
  const shape =
    geometry?.kind === "torus"
      ? new Vector3(geometry.majorRadiusM, geometry.minorRadiusM * 0.72, 1)
      : geometry?.kind === "cylinder"
        ? new Vector3(0, geometry.radiusM * 0.45, geometry.heightM * 0.4)
        : new Vector3(toroidal ? 1 : 0, 0.3, 1);
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
      uAxis: { value: axis === "x" ? 0 : axis === "y" ? 1 : 2 },
      uShape: { value: shape },
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
