/**
 * Uploads assets-dist/ to your Cloudflare R2 bucket with Cloudflare's wrangler CLI.
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… R2_BUCKET=forgelab-assets \
 *     node scripts/assets/upload-r2.mjs
 *
 * Run it on your machine or in CI, never in the browser build: the token can write to
 * the bucket. Files are immutable (cache for a year); manifest.json is cached briefly so
 * a swapped asset shows up within minutes.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "assets-dist");
const bucket = process.env.R2_BUCKET;
for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "R2_BUCKET"])
  if (!process.env[name]) {
    console.error(`Set ${name} first (see docs/ASSETS.md).`);
    process.exit(1);
  }

const TYPES = { ".hdr": "image/vnd.radiance", ".jpg": "image/jpeg", ".json": "application/json" };

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

for (const path of walk(SRC)) {
  const key = relative(SRC, path).split("\\").join("/");
  const manifest = key === "manifest.json";
  execFileSync(
    "npx",
    [
      "--yes",
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucket}/${key}`,
      "--file",
      path,
      "--remote",
      "--content-type",
      TYPES[extname(key)] ?? "application/octet-stream",
      "--cache-control",
      manifest ? "public, max-age=300" : "public, max-age=31536000, immutable",
    ],
    { stdio: "inherit" },
  );
}
console.log("Done. Set VITE_ASSET_BASE_URL to the bucket's public origin and redeploy.");
