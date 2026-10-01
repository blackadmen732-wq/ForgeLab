import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Blending,
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

const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uScale / max(-mv.z, 0.1), 0.0, 512.0);
    vAlpha = alpha;
    vTint = tint;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  uniform float uHard;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float soft = mix(1.0 - d, 1.0 - smoothstep(0.2, 1.0, d), uHard);
    gl_FragColor = vec4(vTint, vAlpha * soft * soft);
  }
`;

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
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.#pos, 3));
    geometry.setAttribute("size", new BufferAttribute(this.#sizeAttr, 1));
    geometry.setAttribute("alpha", new BufferAttribute(this.#alphaAttr, 1));
    geometry.setAttribute("tint", new BufferAttribute(this.#tintAttr, 3));
    this.#material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: this.#look.blending,
      uniforms: {
        uScale: { value: 600 },
        uHard: { value: kind === "sparks" || kind === "spray" ? 1 : 0 },
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
  }

  update(dt: number): void {
    const look = this.#look;
    const drag = Math.exp(-look.drag * dt);
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
    for (const name of ["position", "size", "alpha", "tint"])
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
