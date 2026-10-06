import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Blending,
  Vector2,
} from "three";
import type { ParticleKind, V3 } from "./recipes.js";

/**
 * Pooled particle systems, one draw call each. Particles live in fixed typed arrays
 * (no allocation per particle); dead slots are reused. Motion is simple and physical in
 * spirit: buoyancy (smoke and steam rise, cold vapour sinks and spreads), drag, gravity
 * and a floor bounce for sparks.
 */
interface Look {
  readonly blending: Blending;
  readonly colorStart: Color;
  readonly colorEnd: Color;
  readonly alpha: number;
  /** Vertical acceleration at birth, m/s² (positive rises). */
  readonly buoyancy: number;
  /**
   * Vertical acceleration at the end of life. Cold helium fog first sinks (denser than
   * air), then rises as it warms; steam's droplets evaporate as it rises and slows.
   */
  readonly buoyancyEnd: number;
  /** Linear drag, 1/s. */
  readonly drag: number;
  readonly bounce: number;
  /** Fraction of life spent fading in. */
  readonly fadeIn: number;
}

const LOOKS: Readonly<Record<ParticleKind, Look>> = {
  smoke: {
    blending: NormalBlending,
    colorStart: new Color("#3a3633"),
    colorEnd: new Color("#6b6a68"),
    alpha: 0.55,
    buoyancy: 1.2,
    buoyancyEnd: 1.6,
    drag: 0.6,
    bounce: 0,
    fadeIn: 0.1,
  },
  steam: {
    blending: NormalBlending,
    colorStart: new Color("#f4f7fa"),
    colorEnd: new Color("#c9d2da"),
    alpha: 0.42,
    buoyancy: 2.2,
    buoyancyEnd: 0.8,
    drag: 1.4,
    bounce: 0,
    fadeIn: 0.05,
  },
  vapor: {
    // Cold helium boil-off condenses air moisture: dense white fog that falls.
    blending: NormalBlending,
    colorStart: new Color("#ffffff"),
    colorEnd: new Color("#dde8f2"),
    alpha: 0.5,
    buoyancy: -1.1,
    buoyancyEnd: 0.6,
    drag: 1.2,
    bounce: 0,
    fadeIn: 0.05,
  },
  dust: {
    blending: NormalBlending,
    colorStart: new Color("#8d8578"),
    colorEnd: new Color("#6e6a63"),
    alpha: 0.35,
    buoyancy: -0.35,
    buoyancyEnd: -0.2,
    drag: 1.6,
    bounce: 0,
    fadeIn: 0.15,
  },
  fire: {
    blending: AdditiveBlending,
    colorStart: new Color("#ffcf6b"),
    colorEnd: new Color("#c2410c"),
    alpha: 0.9,
    buoyancy: 5,
    buoyancyEnd: 5,
    drag: 1.8,
    bounce: 0,
    fadeIn: 0.05,
  },
  spray: {
    // Liquid droplets from a break or a seal: thrown, then falling under gravity.
    blending: NormalBlending,
    colorStart: new Color("#e6eef5"),
    colorEnd: new Color("#9fb3c4"),
    alpha: 0.7,
    buoyancy: -9.81,
    buoyancyEnd: -9.81,
    drag: 0.5,
    bounce: 0,
    fadeIn: 0,
  },
  esmoke: {
    // Small electrical-fault smoke: thin, blue-grey, lazy.
    blending: NormalBlending,
    colorStart: new Color("#5a6370"),
    colorEnd: new Color("#8b939c"),
    alpha: 0.4,
    buoyancy: 0.7,
    buoyancyEnd: 0.4,
    drag: 1.1,
    bounce: 0,
    fadeIn: 0.15,
  },
  sparks: {
    blending: AdditiveBlending,
    colorStart: new Color("#fff4c2"),
    colorEnd: new Color("#ff7a1a"),
    alpha: 1,
    buoyancy: -9.81,
    buoyancyEnd: -9.81,
    drag: 0.25,
    bounce: 0.35,
    fadeIn: 0,
  },
};

/**
 * Shaders. Soft kinds (smoke, steam, vapour, dust, fire) are noise-eroded billows: each
 * particle carries a seed and slowly turns, so a plume reads as torn, rolling cloud rather
 * than overlapping discs; normally blended kinds are lit from above to read as volume, and
 * fire has a hot core. Hard kinds (sparks, spray) are streaks stretched along their own
 * screen-space velocity over `uStreak` seconds — motion blur, brightest at the head.
 * Presentation only: the motion is the same either way.
 */
const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  attribute vec3 velocity;
  attribute float seed;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vSeed;
  varying float vAngle;
  varying vec2 vDir;
  varying float vRatio;
  uniform float uScale;
  uniform float uStreak;
  uniform float uTime;
  uniform vec2 uViewport;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = size * uScale / max(-mv.z, 0.1);
    vDir = vec2(1.0, 0.0);
    vRatio = 1.0;
    if (uStreak > 0.0) {
      vec4 tail = projectionMatrix * modelViewMatrix * vec4(position - velocity * uStreak, 1.0);
      vec2 head = gl_Position.xy / gl_Position.w;
      vec2 back = tail.xy / max(tail.w, 1e-3);
      vec2 d = (head - back) * 0.5 * uViewport;
      float full = length(d);
      float len = min(full, 400.0);
      float total = len + px;
      vDir = full > 1e-3 ? d / full : vec2(1.0, 0.0);
      vRatio = px / max(total, 1e-3);
      // Centre the sprite between head and (clamped) tail.
      vec2 mid = (head - back) * 0.5 * (full > 1e-3 ? len / full : 0.0);
      gl_Position.xy -= mid * gl_Position.w;
      px = total;
    }
    gl_PointSize = clamp(px, 0.0, 512.0);
    vAlpha = alpha;
    vTint = tint;
    vSeed = seed;
    vAngle = seed * 6.2832 + uTime * (seed - 0.5) * 0.8;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  varying float vSeed;
  varying float vAngle;
  varying vec2 vDir;
  varying float vRatio;
  uniform float uHard;
  uniform float uLit;
  uniform float uFire;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y; // point coordinates run down the screen; vDir runs up
    if (uHard > 0.5) {
      vec2 q = vec2(dot(p, vDir), dot(p, vec2(-vDir.y, vDir.x)));
      float r = q.x * q.x + (q.y * q.y) / (vRatio * vRatio);
      if (r > 1.0) discard;
      float core = 1.0 - smoothstep(0.0, 1.0, r);
      float head = mix(0.3, 1.0, smoothstep(-1.0, 1.0, q.x));
      gl_FragColor = vec4(mix(vTint, vec3(1.0), core * core * 0.35), vAlpha * core * head);
      return;
    }
    float d = dot(p, p);
    if (d > 1.0) discard;
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 r = mat2(c, -s, s, c) * p;
    float n = fbm(r * 1.6 + vSeed * 37.0);
    float edge = 1.0 - d;
    float density = smoothstep(0.0, 0.55, edge * (0.45 + 1.0 * n) - 0.12);
    vec3 col = vTint;
    if (uLit > 0.5) col *= 0.72 + 0.4 * (p.y * 0.5 + 0.5) + 0.25 * (n - 0.5);
    if (uFire > 0.5) col = mix(col, vec3(1.0, 0.94, 0.78), clamp(pow(edge, 3.0) * n * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col, vAlpha * density);
  }
`;

/** How long a streak's motion blur covers, s (hard kinds only). */
const STREAK_S: Partial<Record<ParticleKind, number>> = { sparks: 0.045, spray: 0.03 };

export class ParticleSystem {
  readonly kind: ParticleKind;
  readonly points: Points;
  readonly capacity: number;
  #look: Look;
  #pos: Float32Array;
  #vel: Float32Array;
  #age: Float32Array;
  #life: Float32Array;
  #size0: Float32Array;
  #size1: Float32Array;
  #sizeAttr: Float32Array;
  #alphaAttr: Float32Array;
  #tintAttr: Float32Array;
  #seedAttr: Float32Array;
  #time = 0;
  #cursor = 0;
  #alive = 0;
  #material: ShaderMaterial;

  constructor(kind: ParticleKind, capacity: number) {
    this.kind = kind;
    this.capacity = capacity;
    this.#look = LOOKS[kind];
    this.#pos = new Float32Array(capacity * 3);
    this.#vel = new Float32Array(capacity * 3);
    this.#age = new Float32Array(capacity).fill(1);
    this.#life = new Float32Array(capacity).fill(1);
    this.#size0 = new Float32Array(capacity);
    this.#size1 = new Float32Array(capacity);
    this.#sizeAttr = new Float32Array(capacity);
    this.#alphaAttr = new Float32Array(capacity);
    this.#tintAttr = new Float32Array(capacity * 3);
    this.#seedAttr = new Float32Array(capacity);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.#pos, 3));
    geometry.setAttribute("size", new BufferAttribute(this.#sizeAttr, 1));
    geometry.setAttribute("alpha", new BufferAttribute(this.#alphaAttr, 1));
    geometry.setAttribute("tint", new BufferAttribute(this.#tintAttr, 3));
    geometry.setAttribute("velocity", new BufferAttribute(this.#vel, 3));
    geometry.setAttribute("seed", new BufferAttribute(this.#seedAttr, 1));
    this.#material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: this.#look.blending,
      uniforms: {
        uScale: { value: 600 },
        uHard: { value: kind === "sparks" || kind === "spray" ? 1 : 0 },
        uLit: { value: this.#look.blending === NormalBlending ? 1 : 0 },
        uFire: { value: kind === "fire" ? 1 : 0 },
        uStreak: { value: STREAK_S[kind] ?? 0 },
        uTime: { value: 0 },
        uViewport: { value: new Vector2(1280, 720) },
      },
    });
    this.points = new Points(geometry, this.#material);
    this.points.frustumCulled = false;
    this.points.renderOrder = kind === "fire" || kind === "sparks" ? 4 : 3;
    this.points.name = `vfx-${kind}`;
  }

  get alive(): number {
    return this.#alive;
  }

  /** Pixel scale for point sizes (viewport height / (2·tan(fov/2))). */
  setScale(scale: number): void {
    this.#material.uniforms["uScale"]!.value = scale;
  }

  /** Drawing-buffer size in pixels (streaks are measured on screen). */
  setViewport(width: number, height: number): void {
    (this.#material.uniforms["uViewport"]!.value as Vector2).set(width, height);
  }

  spawn(
    origin: V3,
    direction: V3,
    spread: number,
    speed: readonly [number, number],
    life: readonly [number, number],
    size: readonly [number, number],
    radius: number,
    random: () => number,
  ): void {
    const i = this.#cursor;
    this.#cursor = (this.#cursor + 1) % this.capacity;
    // Direction within a cone of half-angle `spread` around `direction`.
    const [dx, dy, dz] = normalise(direction);
    const theta = spread * Math.sqrt(random());
    const phi = random() * Math.PI * 2;
    const [ux, uy, uz] = perpendicular(dx, dy, dz);
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const ex = dx * ct + (ux * cp + vx * sp) * st;
    const ey = dy * ct + (uy * cp + vy * sp) * st;
    const ez = dz * ct + (uz * cp + vz * sp) * st;
    const v = speed[0] + (speed[1] - speed[0]) * random();
    const ra = random() * Math.PI * 2;
    const rr = radius * Math.sqrt(random());
    this.#pos[i * 3] = origin[0] + Math.cos(ra) * rr;
    this.#pos[i * 3 + 1] = Math.max(0.05, origin[1] + (random() - 0.5) * radius * 0.5);
    this.#pos[i * 3 + 2] = origin[2] + Math.sin(ra) * rr;
    this.#vel[i * 3] = ex * v;
    this.#vel[i * 3 + 1] = ey * v;
    this.#vel[i * 3 + 2] = ez * v;
    this.#age[i] = 0;
    this.#life[i] = life[0] + (life[1] - life[0]) * random();
    this.#size0[i] = size[0] * (0.8 + 0.4 * random());
    this.#size1[i] = size[1] * (0.8 + 0.4 * random());
    this.#seedAttr[i] = random();
  }

  update(dt: number): void {
    const look = this.#look;
    const drag = Math.exp(-look.drag * dt);
    this.#time += dt;
    this.#material.uniforms["uTime"]!.value = this.#time;
    let alive = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      const life = this.#life[i]!;
      let age = this.#age[i]!;
      if (age >= life) {
        this.#alphaAttr[i] = 0;
        this.#sizeAttr[i] = 0;
        continue;
      }
      age += dt;
      this.#age[i] = age;
      alive += 1;
      const o = i * 3;
      this.#vel[o]! *= drag;
      this.#vel[o + 2]! *= drag;
      const lifeT = age / life;
      const lift = look.buoyancy + (look.buoyancyEnd - look.buoyancy) * lifeT;
      this.#vel[o + 1] = this.#vel[o + 1]! * (look.buoyancy < -5 ? 1 : drag) + lift * dt;
      this.#pos[o]! += this.#vel[o]! * dt;
      this.#pos[o + 1]! += this.#vel[o + 1]! * dt;
      this.#pos[o + 2]! += this.#vel[o + 2]! * dt;
      if (this.#pos[o + 1]! < 0.05) {
        this.#pos[o + 1] = 0.05;
        if (look.bounce > 0) {
          this.#vel[o + 1] = -this.#vel[o + 1]! * look.bounce;
          this.#vel[o]! *= 0.6;
          this.#vel[o + 2]! *= 0.6;
        } else {
          // Heavy gas and dust spread along the floor instead of sinking into it.
          const v = this.#vel[o + 1]!;
          this.#vel[o + 1] = 0;
          this.#vel[o]! += (this.#vel[o]! >= 0 ? 1 : -1) * Math.abs(v) * 0.3;
          this.#vel[o + 2]! += (this.#vel[o + 2]! >= 0 ? 1 : -1) * Math.abs(v) * 0.3;
        }
      }
      const t = age / life;
      const fade = look.fadeIn > 0 && t < look.fadeIn ? t / look.fadeIn : 1;
      this.#alphaAttr[i] = look.alpha * fade * (1 - t) * (1 - t * 0.3);
      this.#sizeAttr[i] = this.#size0[i]! + (this.#size1[i]! - this.#size0[i]!) * Math.sqrt(t);
      const c0 = look.colorStart;
      const c1 = look.colorEnd;
      this.#tintAttr[o] = c0.r + (c1.r - c0.r) * t;
      this.#tintAttr[o + 1] = c0.g + (c1.g - c0.g) * t;
      this.#tintAttr[o + 2] = c0.b + (c1.b - c0.b) * t;
    }
    this.#alive = alive;
    const g = this.points.geometry;
    for (const name of ["position", "size", "alpha", "tint", "velocity", "seed"])
      (g.getAttribute(name) as BufferAttribute).needsUpdate = true;
    this.points.visible = alive > 0;
  }

  clear(): void {
    this.#age.fill(1);
    this.#life.fill(1);
    this.#alphaAttr.fill(0);
    this.#sizeAttr.fill(0);
    this.#alive = 0;
    this.points.visible = false;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.#material.dispose();
  }
}

function normalise(v: V3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function perpendicular(x: number, y: number, z: number): [number, number, number] {
  // Any unit vector perpendicular to (x, y, z).
  const ax = Math.abs(x) < 0.9 ? 1 : 0;
  const ay = ax === 1 ? 0 : 1;
  let px = y * 0 - z * ay;
  let py = z * ax - x * 0;
  let pz = x * ay - y * ax;
  const l = Math.hypot(px, py, pz) || 1;
  px /= l;
  py /= l;
  pz /= l;
  return [px, py, pz];
}
