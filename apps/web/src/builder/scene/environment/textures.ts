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

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d")! };
}

/**
 * Ribbed steel cladding: vertical trapezoidal ribs every `pitchM` with faint streaking.
 * One texture covers `tileM` metres horizontally.
 */
export function ribbedPanelTexture(tileM: number, pitchM: number): Texture {
  const size = 512;
  const { canvas, ctx } = canvas2d(size, size);
  const random = mulberry32(31);
  ctx.fillStyle = "rgb(120,126,134)";
  ctx.fillRect(0, 0, size, size);
  const ribs = Math.round(tileM / pitchM);
  const w = size / ribs;
  for (let i = 0; i < ribs; i += 1) {
    const x = i * w;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "rgba(255,255,255,0.10)");
    g.addColorStop(0.18, "rgba(255,255,255,0.02)");
    g.addColorStop(0.5, "rgba(0,0,0,0.04)");
    g.addColorStop(0.82, "rgba(0,0,0,0.16)");
    g.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, size);
  }
  // Streaks and weathering.
  for (let i = 0; i < 160; i += 1) {
    const x = random() * size;
    const len = 40 + random() * 300;
    ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${0.015 + random() * 0.03})`;
    ctx.fillRect(x, random() * size, 1 + random() * 3, len);
  }
  // Panel laps.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, size, 3);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Soft radial falloff used for floor light pools and glows. */
export function radialTexture(): Texture {
  const size = 256;
  const { canvas, ctx } = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(0.7, "rgba(255,255,255,0.1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Engineering grid labels, painted into the floor: axis numbers every 10 m along the
 * edges of the build zone. Covers `widthM` × `depthM` centred on the origin.
 */
export function gridLabelTexture(
  widthM: number,
  depthM: number,
  halfX: number,
  halfZ: number,
): Texture {
  const ppm = 16;
  const { canvas, ctx } = canvas2d(Math.round(widthM * ppm), Math.round(depthM * ppm));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(210,220,232,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(0.9 * ppm)}px "IBM Plex Mono", ui-monospace, monospace`;
  const px = (x: number) => (x + widthM / 2) * ppm;
  const pz = (z: number) => (z + depthM / 2) * ppm;
  for (let x = -halfX; x <= halfX; x += 10) {
    const label = x === 0 ? "0" : `${x > 0 ? "+" : "−"}${Math.abs(x)}`;
    ctx.fillText(label, px(x), pz(halfZ + 1.6));
    ctx.fillText(label, px(x), pz(-halfZ - 1.6));
  }
  for (let z = -halfZ; z <= halfZ; z += 10) {
    const label = String.fromCharCode(65 + Math.round((z + halfZ) / 10));
    ctx.fillText(label, px(-halfX - 1.8), pz(z));
    ctx.fillText(label, px(halfX + 1.8), pz(z));
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
