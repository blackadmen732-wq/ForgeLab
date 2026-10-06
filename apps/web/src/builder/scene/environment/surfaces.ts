import {
  type BufferGeometry,
  CanvasTexture,
  type ColorSpace,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

/**
 * Procedural surface detail for the hall and the machines: steel deck plate, worn metal,
 * hazard striping. Presentation only — these maps change how a surface catches light,
 * never what it is made of. Everything is generated from a seeded PRNG, so every load
 * (and every viewer) sees the same scratches in the same places.
 */

export interface SurfaceMaps {
  /** Albedo multiplier (sRGB): near white, so the material's own colour still rules. */
  readonly map: Texture;
  /** Roughness in the green channel (linear). */
  readonly roughnessMap: Texture;
  /** Tangent-space normal map (linear). */
  readonly normalMap: Texture;
}

/**
 * Replaces a geometry's UVs with box-projected coordinates in metres (u, v along the two
 * axes across each vertex's dominant normal), so a surface texture keeps its real size
 * on a 0.2 m bracket and a 40 m girder alike.
 */
export function boxProjectUVs(geometry: BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  if (uv === undefined || normal === undefined) return;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x, z);
    else if (nx >= nz) uv.setXY(i, z, y);
    else uv.setXY(i, x, y);
  }
  uv.needsUpdate = true;
}

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

function canvas2d(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true })! };
}

function texture(canvas: HTMLCanvasElement, colorSpace: ColorSpace): Texture {
  const t = new CanvasTexture(canvas);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

/** Soft blob: a radial gradient of `alpha` at the centre fading to nothing. */
function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rgb: string,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** Draws `paint` at every wrapped copy of a feature near the tile edge, so tiles join seamlessly. */
function wrapped(
  size: number,
  x: number,
  y: number,
  r: number,
  paint: (x: number, y: number) => void,
) {
  for (const dx of [-size, 0, size])
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
      paint(px, py);
    }
}

/** Tangent-space normal map from a wrapped height field (0–1) by central differences. */
function normalFromHeight(height: Float32Array, size: number, strength: number): Texture {
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // Canvas rows run downwards; texture v runs upwards.
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      image.data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return texture(canvas, NoColorSpace);
}

/** Reads a greyscale canvas into a float field. */
function heightField(ctx: CanvasRenderingContext2D, size: number): Float32Array {
  const data = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i += 1) out[i] = data[i * 4]! / 255;
  return out;
}

/**
 * Steel deck plate, as on a reactor-hall floor: one tile covers `tileM` metres, laid in
 * staggered 3 × 1.5 m plates with ground seams, countersunk fixings, brushing, grime along
 * the joints, the odd rust bloom, and standing water that turns the plate glossy.
 */
export function steelDeckMaps(tileM = 12, seed = 4021): SurfaceMaps {
  const size = 1024;
  const ppm = size / tileM;
  const random = mulberry32(seed);
  const plateW = 3 * ppm;
  const plateH = 1.5 * ppm;
  const rows = Math.round(size / plateH);
  const cols = Math.round(size / plateW);

  const albedo = canvas2d(size);
  const rough = canvas2d(size);
  const height = canvas2d(size);
  const a = albedo.ctx;
  const r = rough.ctx;
  const h = height.ctx;
  a.fillStyle = "rgb(150,152,154)";
  a.fillRect(0, 0, size, size);
  r.fillStyle = "rgb(110,110,110)";
  r.fillRect(0, 0, size, size);
  h.fillStyle = "rgb(200,200,200)";
  h.fillRect(0, 0, size, size);

  const plates: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 === 0 ? 0 : plateW / 2;
    for (let col = 0; col < cols; col += 1)
      plates.push({ x: col * plateW + offset, y: row * plateH });
  }
  for (const p of plates) {
    // Each plate came from a different heat: slightly different tone and finish.
    const tone = 132 + (random() - 0.5) * 16;
    const warm = (random() - 0.5) * 6;
    const finish = 95 + random() * 40;
    const paint = (x: number, y: number) => {
      a.fillStyle = `rgb(${tone + warm},${tone},${tone - warm})`;
      a.fillRect(x, y, plateW, plateH);
      r.fillStyle = `rgb(${finish},${finish},${finish})`;
      r.fillRect(x, y, plateW, plateH);
      // Brushing along the plate.
      for (let i = 0; i < 70; i += 1) {
        const yy = y + random() * plateH;
        const light = random() > 0.5;
        a.fillStyle = light ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
        a.fillRect(x + random() * plateW * 0.3, yy, plateW * (0.3 + random() * 0.7), 1);
      }
      // Countersunk fixings near each corner.
      for (const [fx, fy] of [
        [0.06, 0.12],
        [0.94, 0.12],
        [0.06, 0.88],
        [0.94, 0.88],
        [0.5, 0.12],
        [0.5, 0.88],
      ] as const) {
        const bx = x + fx * plateW;
        const by = y + fy * plateH;
        a.fillStyle = "rgba(40,40,42,0.85)";
        a.beginPath();
        a.arc(bx, by, 5, 0, Math.PI * 2);
        a.fill();
        a.fillStyle = "rgba(150,150,152,0.9)";
        a.beginPath();
        a.arc(bx, by, 3, 0, Math.PI * 2);
        a.fill();
        h.fillStyle = "rgb(150,150,150)";
        h.beginPath();
        h.arc(bx, by, 5, 0, Math.PI * 2);
        h.fill();
        h.fillStyle = "rgb(190,190,190)";
        h.beginPath();
        h.arc(bx, by, 3, 0, Math.PI * 2);
        h.fill();
      }
    };
    wrapped(size, p.x + plateW / 2, p.y + plateH / 2, plateW, (cx, cy) =>
      paint(cx - plateW / 2, cy - plateH / 2),
    );
  }
  // Seams: a ground groove with grime collected along it.
  for (const p of plates) {
    const seam = (x: number, y: number) => {
      a.strokeStyle = "rgba(18,18,20,0.9)";
      a.lineWidth = 3;
      a.strokeRect(x, y, plateW, plateH);
      a.strokeStyle = "rgba(40,34,28,0.25)";
      a.lineWidth = 12;
      a.strokeRect(x, y, plateW, plateH);
      r.strokeStyle = "rgb(225,225,225)";
      r.lineWidth = 6;
      r.strokeRect(x, y, plateW, plateH);
      h.strokeStyle = "rgb(40,40,40)";
      h.lineWidth = 3;
      h.strokeRect(x, y, plateW, plateH);
    };
    wrapped(size, p.x + plateW / 2, p.y + plateH / 2, plateW, (cx, cy) =>
      seam(cx - plateW / 2, cy - plateH / 2),
    );
  }
  // Traffic wear: lighter, smoother bands where trolleys and boots go.
  for (let i = 0; i < 30; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const rad = 40 + random() * 140;
    wrapped(size, x, y, rad, (px, py) => {
      blob(a, px, py, rad, "235,235,235", 0.08);
      blob(r, px, py, rad, "0,0,0", 0.18);
    });
  }
  // Grime and oil.
  for (let i = 0; i < 36; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const rad = 10 + random() * 70;
    const oil = random() > 0.75;
    wrapped(size, x, y, rad, (px, py) => {
      blob(a, px, py, rad, oil ? "20,18,16" : "60,52,44", oil ? 0.16 : 0.07);
      blob(r, px, py, rad, oil ? "0,0,0" : "255,255,255", oil ? 0.3 : 0.15);
    });
  }
  // Occasional rust bloom at a fixing or seam.
  for (let i = 0; i < 10; i += 1) {
    const p = plates[Math.floor(random() * plates.length)]!;
    const x = p.x + (random() > 0.5 ? 0.06 : 0.94) * plateW;
    const y = p.y + (random() > 0.5 ? 0.12 : 0.88) * plateH;
    const rad = 8 + random() * 22;
    wrapped(size, x, y, rad, (px, py) => {
      blob(a, px, py, rad, "120,62,30", 0.3);
      blob(r, px, py, rad, "255,255,255", 0.5);
    });
  }
  // Standing water: large irregular puddles where the plate is near-mirror smooth.
  for (let i = 0; i < 9; i += 1) {
    const x = random() * size;
    const y = random() * size;
    for (let k = 0; k < 7; k += 1) {
      const px0 = x + (random() - 0.5) * 220;
      const py0 = y + (random() - 0.5) * 120;
      const rad = 40 + random() * 90;
      wrapped(size, px0, py0, rad, (px, py) => {
        blob(r, px, py, rad, "0,0,0", 0.6);
        blob(a, px, py, rad, "30,32,36", 0.06);
      });
    }
  }
  // Scratches.
  for (let i = 0; i < 220; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI;
    const len = 6 + random() * 40;
    a.strokeStyle = `rgba(215,215,215,${0.08 + random() * 0.15})`;
    a.lineWidth = 1;
    a.beginPath();
    a.moveTo(x, y);
    a.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    a.stroke();
  }
  // Fine grain in the height map.
  const grain = h.getImageData(0, 0, size, size);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (random() - 0.5) * 6;
    grain.data[i] =
      grain.data[i + 1] =
      grain.data[i + 2] =
        Math.max(0, Math.min(255, grain.data[i]! + n));
  }
  h.putImageData(grain, 0, 0);

  const maps = {
    map: texture(albedo.canvas, SRGBColorSpace),
    roughnessMap: texture(rough.canvas, NoColorSpace),
    normalMap: normalFromHeight(heightField(h, size), size, 2.5),
  };
  for (const t of Object.values(maps)) t.userData = { tileM };
  return maps;
}

/**
 * Worn industrial metal for steelwork and machine casings: smudges, handling marks, drip
 * streaks running down, fine scratches and slight unevenness. One tile covers `tileM`
 * metres; apply with world-scale (box-projected) UVs so the wear keeps its size.
 */
export function wornMetalMaps(tileM = 2, seed = 977): SurfaceMaps {
  const size = 512;
  const random = mulberry32(seed);
  const albedo = canvas2d(size);
  const rough = canvas2d(size);
  const height = canvas2d(size);
  const a = albedo.ctx;
  const r = rough.ctx;
  const h = height.ctx;
  a.fillStyle = "rgb(236,236,236)";
  a.fillRect(0, 0, size, size);
  r.fillStyle = "rgb(128,128,128)";
  r.fillRect(0, 0, size, size);
  h.fillStyle = "rgb(128,128,128)";
  h.fillRect(0, 0, size, size);

  // Broad mottling in tone and finish.
  for (let i = 0; i < 90; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const rad = 50 + random() * 150;
    const dark = random() > 0.4;
    const k = random();
    const rougher = random() > 0.5 ? "255,255,255" : "0,0,0";
    const raised = random() > 0.5 ? "255,255,255" : "0,0,0";
    wrapped(size, x, y, rad, (px, py) => {
      blob(a, px, py, rad, dark ? "70,64,58" : "255,255,255", dark ? 0.06 * k : 0.06 * k);
      blob(r, px, py, rad, rougher, 0.12 * k);
      blob(h, px, py, rad, raised, 0.05 * k);
    });
  }
  // Drip streaks running down from edges and fixings.
  for (let i = 0; i < 70; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const len = 30 + random() * 200;
    const w = 1 + random() * 4;
    const alpha = 0.12 + random() * 0.18;
    const paint = (px: number, py: number) => {
      const g = a.createLinearGradient(px, py, px, py + len);
      g.addColorStop(0, `rgba(60,52,44,${alpha})`);
      g.addColorStop(1, "rgba(60,52,44,0)");
      a.fillStyle = g;
      a.fillRect(px, py, w, len);
      r.fillStyle = "rgba(255,255,255,0.12)";
      r.fillRect(px, py, w, len * 0.7);
    };
    wrapped(size, x, y + len / 2, len, (px, py) => paint(px, py - len / 2));
  }
  // Handling scratches: bright, smooth, slightly cut in.
  for (let i = 0; i < 260; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const angle = (random() - 0.5) * 0.8 + (random() > 0.5 ? 0 : Math.PI / 2);
    const len = 4 + random() * 30;
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    const alpha = 0.1 + random() * 0.25;
    a.strokeStyle = `rgba(255,255,255,${alpha})`;
    r.strokeStyle = `rgba(0,0,0,${alpha * 1.4})`;
    h.strokeStyle = `rgba(0,0,0,${alpha})`;
    for (const ctx of [a, r, h]) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  // Fine grain.
  for (const ctx of [r, h]) {
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (random() - 0.5) * 14;
      img.data[i] =
        img.data[i + 1] =
        img.data[i + 2] =
          Math.max(0, Math.min(255, img.data[i]! + n));
    }
    ctx.putImageData(img, 0, 0);
  }

  const maps = {
    map: texture(albedo.canvas, SRGBColorSpace),
    roughnessMap: texture(rough.canvas, NoColorSpace),
    normalMap: normalFromHeight(heightField(h, size), size, 1.2),
  };
  for (const t of Object.values(maps)) t.userData = { tileM };
  return maps;
}

/**
 * Painted yellow/black hazard striping (45°), scuffed. One tile covers `tileM` metres
 * and the stripes run diagonally in texture space, so any band cut from it reads right.
 */
export function hazardStripeTexture(tileM = 1, seed = 61): Texture {
  const size = 256;
  const random = mulberry32(seed);
  const { canvas, ctx } = canvas2d(size);
  ctx.fillStyle = "rgb(214,168,32)";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgb(22,22,22)";
  const n = 4; // stripe pairs per tile
  const w = size / n;
  for (let i = -n; i < 2 * n; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * w, 0);
    ctx.lineTo(i * w + w / 2, 0);
    ctx.lineTo(i * w + w / 2 + size, size);
    ctx.lineTo(i * w + size, size);
    ctx.closePath();
    ctx.fill();
  }
  // Scuffing where traffic has worn through the paint.
  for (let i = 0; i < 90; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const rad = 2 + random() * 14;
    const alpha = 0.3 + random() * 0.3;
    wrapped(size, x, y, rad, (px, py) => blob(ctx, px, py, rad, "95,95,95", alpha));
  }
  const t = texture(canvas, SRGBColorSpace);
  t.userData = { tileM };
  return t;
}

let partMaps: SurfaceMaps | null = null;

/**
 * Worn-metal maps shared by every machine casing (2 m per tile, for box-projected UVs).
 * Created on first use and kept for the page's lifetime.
 */
export function partWearMaps(): SurfaceMaps {
  if (partMaps === null) {
    partMaps = wornMetalMaps(2, 5303);
    for (const t of Object.values(partMaps)) t.repeat.set(0.5, 0.5);
  }
  return partMaps;
}
