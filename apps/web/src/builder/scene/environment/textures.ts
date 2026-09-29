import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/** Small deterministic PRNG so the floor looks the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Polished concrete: one texture covers `tileM` metres (two slabs per side), with saw-cut
 * joints, trowel mottling and faint wear. Tiled across the hall floor.
 */
export function concreteTexture(tileM: number, dark: boolean): Texture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const random = mulberry32(7);
  const base = dark ? [38, 42, 47] : [92, 97, 103];

  ctx.fillStyle = `rgb(${base.join(",")})`;
  ctx.fillRect(0, 0, size, size);

  // Mottling: many soft low-contrast blotches.
  for (let i = 0; i < 900; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 8 + random() * 60;
    const shade = (random() - 0.5) * (dark ? 10 : 16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(
      0,
      `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${shade > 0 ? 255 : 0},${Math.abs(shade) / 255})`,
    );
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Fine aggregate speckle.
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (random() - 0.5) * 9;
    image.data[i] = Math.max(0, Math.min(255, image.data[i]! + n));
    image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1]! + n));
    image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2]! + n));
  }
  ctx.putImageData(image, 0, 0);

  // Saw-cut joints between slabs (two slabs per tile in each direction).
  ctx.strokeStyle = dark ? "rgba(0,0,0,0.55)" : "rgba(25,28,32,0.55)";
  ctx.lineWidth = 3;
  for (const t of [0, size / 2]) {
    ctx.beginPath();
    ctx.moveTo(t + 1.5, 0);
    ctx.lineTo(t + 1.5, size);
    ctx.moveTo(0, t + 1.5);
    ctx.lineTo(size, t + 1.5);
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData = { tileM };
  return texture;
}
