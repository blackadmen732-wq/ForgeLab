#!/usr/bin/env node
/**
 * Serves .vercel/output locally the way Vercel does for this project: config.json headers,
 * static files, /api/* functions, and the SPA fallback. Used for end-to-end tests and for
 * `pnpm dev:api` (Vite proxies /api here during development).
 *
 *   node scripts/serve-output.mjs [port]      (default 3000)
 *
 * Server env (SUPABASE_URL, SUPABASE_SECRET_KEY) is read from the process environment.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", ".vercel", "output");
const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
if (!existsSync(join(root, "config.json"))) {
  console.error("No .vercel/output found. Run `pnpm vercel-build` first.");
  process.exit(1);
}
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};
const functions = new Map();
async function fn(name) {
  if (!functions.has(name)) {
    const dir = join(root, "functions", "api", `${name}.func`);
    if (!existsSync(dir)) return null;
    const vc = JSON.parse(readFileSync(join(dir, ".vc-config.json"), "utf8"));
    functions.set(name, (await import(pathToFileURL(join(dir, vc.handler)).href)).default);
  }
  return functions.get(name);
}
function staticFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, "static", clean);
  if (!file.startsWith(join(root, "static"))) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let dest = url.pathname;
  let status = 200;
  let phase = "pre";
  for (const route of config.routes) {
    if (route.handle === "filesystem") {
      phase = "fs";
      const api = /^\/api\/([\w-]+)$/.exec(dest);
      if (staticFile(dest) || (api && (await fn(api[1])))) break;
      continue;
    }
    const match = new RegExp(`^${route.src}$`).exec(dest);
    if (!match) continue;
    for (const [k, v] of Object.entries(route.headers ?? {})) res.setHeader(k, v);
    if (route.status) status = route.status;
    if (route.dest) dest = route.dest;
    if (!route.continue && phase === "fs") break;
  }
  const api = /^\/api\/([\w-]+)$/.exec(dest);
  if (api && status === 200) {
    const handler = await fn(api[1]);
    if (handler) return handler(req, res);
  }
  const file = staticFile(dest);
  if (status !== 200 || file === null) {
    res.statusCode = status === 200 ? 404 : status;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: "Not found." }));
  }
  res.statusCode = 200;
  res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`ForgeLab (production build) on http://localhost:${port}`));
