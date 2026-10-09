import { type Camera, Vector3 } from "three";
import type { V3 } from "./recipes.js";

/**
 * Camera effects: trauma-driven shake (Perlin-like smooth noise, amplitude ∝ trauma²),
 * a one-off kick away from the event, and a brief exposure lift. Strength falls off with
 * distance from the event and scales with the viewer's camera-effects setting; with
 * reduced motion there is no movement at all.
 */
export class CameraEffects {
  #trauma = 0;
  #kick = new Vector3();
  #flash = 0;
  #offset = new Vector3();
  #applied = false;
  #t = 0;

  get busy(): boolean {
    return this.#trauma > 0.001 || this.#kick.lengthSq() > 1e-6 || this.#flash > 0.001;
  }

  get exposure(): number {
    return 1 + 0.9 * this.#flash;
  }

  add(
    origin: V3,
    camera: Vector3,
    trauma: number,
    kick: number,
    flash: number,
    intensity: number,
    motion: boolean,
    reducedEffects: boolean,
  ): void {
    const d = Math.hypot(camera.x - origin[0], camera.y - origin[1], camera.z - origin[2]);
    const falloff = 1 / (1 + (d / 35) ** 2);
    if (motion) {
      this.#trauma = Math.min(1, this.#trauma + trauma * falloff * intensity);
      const away = new Vector3(camera.x - origin[0], camera.y - origin[1], camera.z - origin[2]);
      if (away.lengthSq() > 1e-6)
        this.#kick.add(away.normalize().multiplyScalar(kick * falloff * intensity * 0.6));
    }
    if (!reducedEffects) this.#flash = Math.min(1, this.#flash + flash * falloff);
  }

  /** Undo last frame's offset before the orbit controls read the camera. */
  restore(camera: Camera): void {
    if (!this.#applied) return;
    camera.position.sub(this.#offset);
    this.#applied = false;
  }

  /** Decay and apply this frame's offset. */
  apply(camera: Camera, dt: number): void {
    this.#t += dt;
    this.#trauma = Math.max(0, this.#trauma - dt * 0.8);
    this.#kick.multiplyScalar(Math.exp(-dt * 7));
    this.#flash = Math.max(0, this.#flash - dt * 2.5);
    const a = this.#trauma * this.#trauma;
    if (a < 1e-4 && this.#kick.lengthSq() < 1e-6) return;
    const t = this.#t;
    const n = (k: number) =>
      Math.sin(t * (13 + k) + k * 1.7) * 0.6 + Math.sin(t * (29 + 2 * k) + k) * 0.4;
    this.#offset.set(n(1) * a * 0.8, n(2) * a * 0.6, n(3) * a * 0.8).add(this.#kick);
    camera.position.add(this.#offset);
    this.#applied = true;
  }

  clear(): void {
    this.#trauma = 0;
    this.#kick.set(0, 0, 0);
    this.#flash = 0;
  }
}
