import { localPointToWorld, Vec3Math, type Vec3 } from "@forgelab/shared";
import { currentTransform, type SimulationComponent } from "@forgelab/sim-core";

/**
 * A uniform-grid spatial hash of socket positions. Snapping and automatic connection ask
 * "which compatible sockets are within r of this point?"; with the index that costs a
 * look at 27 cells instead of every socket in the scene, which keeps moving or
 * duplicating hundreds of parts O(N) instead of O(N²). See docs/PERFORMANCE.md.
 */
export interface IndexedSocket {
  readonly componentId: string;
  readonly socketId: string;
  readonly type: string;
  readonly position: Vec3;
}

export class SocketIndex {
  readonly #cell: number;
  readonly #cells = new Map<string, IndexedSocket[]>();

  constructor(cellM: number) {
    this.#cell = Math.max(1e-3, cellM);
  }

  static of(components: Iterable<SimulationComponent>, cellM: number): SocketIndex {
    const index = new SocketIndex(cellM);
    for (const component of components) {
      const t = currentTransform(component);
      for (const socket of component.connectionPoints) {
        index.add({
          componentId: component.id,
          socketId: socket.id,
          type: socket.connectionType,
          position: localPointToWorld(t, socket.localPosition),
        });
      }
    }
    return index;
  }

  #key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  add(socket: IndexedSocket): void {
    const c = this.#cell;
    const key = this.#key(
      Math.floor(socket.position.x / c),
      Math.floor(socket.position.y / c),
      Math.floor(socket.position.z / c),
    );
    const bucket = this.#cells.get(key);
    if (bucket) bucket.push(socket);
    else this.#cells.set(key, [socket]);
  }

  /** Sockets of `type` within `radius` of `point` (radius must not exceed the cell size). */
  near(point: Vec3, radius: number, type: string): { socket: IndexedSocket; distance: number }[] {
    const c = this.#cell;
    const cx = Math.floor(point.x / c);
    const cy = Math.floor(point.y / c);
    const cz = Math.floor(point.z / c);
    const out: { socket: IndexedSocket; distance: number }[] = [];
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const socket of this.#cells.get(this.#key(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (socket.type !== type) continue;
            const distance = Vec3Math.distance(point, socket.position);
            if (distance <= radius) out.push({ socket, distance });
          }
        }
    return out.sort((a, b) => a.distance - b.distance);
  }
}
