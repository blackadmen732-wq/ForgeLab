import {
  CanvasTexture,
  Euler,
  type Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector3,
} from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";

/**
 * Damage left on a machine's surface for the rest of the run: scorch where an arc struck,
 * soot above burning insulation, frost where cold helium vented, cracks where a member
 * failed, a torn opening where a pipe ruptured. Each mark is projected onto the part's
 * actual surface (a decal), placed where the destruction event says it happened. Cleared
 * on reset; never saved with the design.
 */
export type MarkKind = "scorch" | "soot" | "frost" | "crack" | "tear";

type Rand = () => number;

function canvas(size = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

/** Irregular blotch: soft centre, ragged rim. */
function blotch(g: CanvasRenderingContext2D, rand: Rand, rgb: string, alpha: number): void {
  const s = g.canvas.width;
  for (let k = 0; k < 14; k += 1) {
    const r = s * (0.12 + rand() * 0.26);
    const x = s / 2 + (rand() - 0.5) * s * 0.35;
    const y = s / 2 + (rand() - 0.5) * s * 0.35;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(0.6, `rgba(${rgb},${alpha * 0.55})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function drawMark(kind: MarkKind, rand: Rand): CanvasTexture {
  const [c, g] = canvas();
  const s = c.width;
  switch (kind) {
    case "scorch":
      blotch(g, rand, "20,14,10", 0.75);
      blotch(g, rand, "70,45,25", 0.35);
      break;
    case "soot": {
      // Streaks rising from the source at the bottom edge.
      for (let k = 0; k < 40; k += 1) {
        const x = s * (0.25 + rand() * 0.5);
        const w = s * (0.02 + rand() * 0.06);
        const grad = g.createLinearGradient(0, s, 0, s * (0.05 + rand() * 0.3));
        grad.addColorStop(0, "rgba(12,12,12,0.55)");
        grad.addColorStop(1, "rgba(12,12,12,0)");
        g.fillStyle = grad;
        g.fillRect(x - w / 2, 0, w, s);
      }
      break;
    }
    case "frost": {
      blotch(g, rand, "232,242,255", 0.45);
      for (let k = 0; k < 500; k += 1) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * s * 0.45;
        g.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.6})`;
        g.fillRect(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 1.5, 1.5);
      }
      break;
    }
    case "crack": {
      g.strokeStyle = "rgba(8,8,8,0.9)";
      g.lineCap = "round";
      const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
        if (depth <= 0 || len < 4) return;
        const x2 = x + Math.cos(a) * len;
        const y2 = y + Math.sin(a) * len;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x2, y2);
        g.stroke();
        branch(x2, y2, a + (rand() - 0.5) * 0.9, len * 0.75, w * 0.7, depth - 1);
        if (rand() < 0.45)
          branch(
            x2,
            y2,
            a + (rand() < 0.5 ? 1 : -1) * (0.5 + rand()),
            len * 0.55,
            w * 0.6,
            depth - 2,
          );
      };
      for (let k = 0; k < 5; k += 1) branch(s / 2, s / 2, rand() * Math.PI * 2, s * 0.12, 4, 6);
      break;
    }
    case "tear": {
      // A dark ragged opening with a bright torn-metal rim.
      const pts: [number, number][] = [];
      for (let k = 0; k < 18; k += 1) {
        const a = (k / 18) * Math.PI * 2;
        const r = s * (0.18 + rand() * 0.16);
        pts.push([s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r * 0.6]);
      }
      g.beginPath();
      pts.forEach(([x, y], k) => (k === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.closePath();
      g.fillStyle = "rgba(6,6,7,0.95)";
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = "rgba(190,195,200,0.85)";
      g.stroke();
      blotch(g, rand, "40,36,32", 0.3);
      break;
    }
  }
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const MARK_LOOK: Readonly<Record<MarkKind, { roughness: number; metalness: number }>> = {
  scorch: { roughness: 1, metalness: 0 },
  soot: { roughness: 1, metalness: 0 },
  frost: { roughness: 0.6, metalness: 0 },
  crack: { roughness: 0.9, metalness: 0 },
  tear: { roughness: 0.5, metalness: 0.5 },
};

const raycaster = new Raycaster();
const tmp = new Vector3();

export class MarkLayer {
  readonly #root: Group;
  readonly #marks: Mesh[] = [];
  #limit: number;

  constructor(root: Group, limit: number) {
    this.#root = root;
    this.#limit = limit;
  }

  setLimit(limit: number): void {
    this.#limit = limit;
  }

  get count(): number {
    return this.#marks.length;
  }

  /**
   * Projects a mark onto `target` (the part's group) where a ray from `from` towards
   * `towards` first meets its surface. Returns false when the ray misses the part.
   */
  add(
    kind: MarkKind,
    target: Object3D,
    from: Vector3,
    towards: Vector3,
    sizeM: number,
    rand: Rand,
  ): boolean {
    if (this.#marks.length >= this.#limit) return false;
    target.updateMatrixWorld(true);
    raycaster.set(from, tmp.subVectors(towards, from).normalize());
    const hit = raycaster
      .intersectObject(target, true)
      .find(
        (h) =>
          h.object instanceof Mesh && h.face !== null && h.face !== undefined && h.object.visible,
      );
    if (hit === undefined || hit.face === null || hit.face === undefined) return false;
    const mesh = hit.object as Mesh;
    const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
    const orientation = new Euler().setFromQuaternion(
      new Quaternion().setFromRotationMatrix(
        new Matrix4().lookAt(new Vector3(), normal, new Vector3(0, 1, 0)),
      ),
    );
    // Soot rises: keep its streaks pointing up; others take a random roll.
    if (kind !== "soot") orientation.z = rand() * Math.PI * 2;
    const depth = Math.max(0.3, sizeM);
    const geometry = new DecalGeometry(
      mesh,
      hit.point,
      orientation,
      new Vector3(sizeM, sizeM, depth),
    );
    if (!geometry.getAttribute("position") || geometry.getAttribute("position").count === 0) {
      geometry.dispose();
      return false;
    }
    const look = MARK_LOOK[kind];
    const material = new MeshStandardMaterial({
      map: drawMark(kind, rand),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: look.roughness,
      metalness: look.metalness,
    });
    const decal = new Mesh(geometry, material);
    decal.name = `mark:${kind}`;
    decal.renderOrder = 3;
    this.#root.add(decal);
    this.#marks.push(decal);
    return true;
  }

  clear(): void {
    for (const m of this.#marks) {
      this.#root.remove(m);
      m.geometry.dispose();
      const material = m.material as MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.#marks.length = 0;
  }
}
