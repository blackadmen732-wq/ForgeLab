/**
 * Downloads the CC0 assets in catalog.mjs from Poly Haven into assets-dist/, checks each
 * file against Poly Haven's md5, and writes assets-dist/manifest.json for the app.
 *
 *   node scripts/assets/fetch-polyhaven.mjs
 *   node scripts/assets/upload-r2.mjs        # then put them in your R2 bucket
 *
 * assets-dist/ is not committed: the bucket is the source the app loads from.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./catalog.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "assets-dist");
const API = "https://api.polyhaven.com";

async function json(url) {
  const res = await fetch(url, { headers: { "User-Agent": "ForgeLab asset fetch" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function download(file, key) {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const md5 = createHash("md5").update(bytes).digest("hex");
  if (file.md5 && md5 !== file.md5) throw new Error(`${file.url}: checksum mismatch`);
  const path = join(OUT, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`  ${key} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  return key;
}

const assets = {};
for (const entry of CATALOG) {
  console.log(`${entry.slot}: ${entry.polyhaven}`);
  const [info, files] = await Promise.all([
    json(`${API}/info/${entry.polyhaven}`),
    json(`${API}/files/${entry.polyhaven}`),
  ]);
  const common = {
    kind: entry.kind,
    name: info.name,
    authors: Object.keys(info.authors ?? {}),
    license: "CC0-1.0",
    source: `https://polyhaven.com/a/${entry.polyhaven}`,
  };
  if (entry.kind === "hdri") {
    const file = files.hdri[entry.resolution].hdr;
    const key = await download(file, `hdri/${entry.polyhaven}_${entry.resolution}.hdr`);
    assets[entry.slot] = { ...common, url: key };
  } else {
    const maps = {};
    for (const [phName, slot] of Object.entries(entry.maps)) {
      const file = files[phName][entry.resolution].jpg;
      maps[slot] = await download(
        file,
        `textures/${entry.polyhaven}/${entry.polyhaven}_${phName}_${entry.resolution}.jpg`,
      );
    }
    // Poly Haven dimensions are millimetres: one texture tile in metres.
    const tileM = Array.isArray(info.dimensions) ? info.dimensions[0] / 1000 : 1;
    assets[entry.slot] = { ...common, maps, tileM };
  }
}

const manifest = { version: 1, generatedAtIso: new Date().toISOString(), assets };
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${join(OUT, "manifest.json")}`);
