#!/usr/bin/env node
/**
 * Produces a Vercel Build Output API (v3) bundle in .vercel/output:
 *
 *   static/                     the Vite SPA (apps/web/dist)
 *   functions/api/verify.func/  the verification function, bundled with esbuild
 *   config.json                 security headers, caching, SPA fallback
 *
 * It also enforces the rule that no server secret reaches the browser: the build fails if
 * a VITE_-prefixed variable holds a secret key, or if one appears in the built JavaScript.
 *
 * Usage: pnpm vercel-build   (runs the web build first, then this script)
 */
import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".vercel", "output");
const dist = join(root, "apps", "web", "dist");

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/* ---------------- environment validation ---------------- */

function isSecretKey(value) {
  if (typeof value !== "string" || value === "") return false;
  if (value.startsWith("sb_secret_")) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith("VITE_") && isSecretKey(value)) {
    fail(
      `${name} holds a Supabase secret/service-role key. Browser variables must only hold the publishable key.`,
    );
  }
}

// Other server secrets must never be copied into browser variables either.
const serverSecrets = [process.env.LIVEKIT_API_SECRET, process.env.FORGELAB_PRESENCE_KEY]
  .map((v) => (v ?? "").trim())
  .filter((v) => v.length >= 16);
for (const [name, value] of Object.entries(process.env)) {
  if (
    name.startsWith("VITE_") &&
    (serverSecrets.includes((value ?? "").trim()) || /BEGIN (EC )?PRIVATE KEY/.test(value ?? ""))
  ) {
    fail(`${name} holds a server secret (LiveKit secret or presence private key).`);
  }
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? "").trim();
const publishable = (
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  ""
).trim();
if (supabaseUrl === "" || publishable === "") {
  console.warn(
    "⚠ VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set: the site builds in local-only mode (no accounts, cloud saves or leaderboards).",
  );
}
if (
  process.env.VERCEL_ENV === "production" &&
  (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") === ""
) {
  console.warn(
    "⚠ SUPABASE_SECRET_KEY is not set: /api/verify will answer 500 until it is configured.",
  );
}

if (!existsSync(join(dist, "index.html")))
  fail("apps/web/dist is missing. Run the web build first (pnpm build).");

/* ---------------- secret scan of the browser bundle ---------------- */

const secretPatterns = [
  /sb_secret_[A-Za-z0-9_-]{8,}/,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];
function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}
for (const file of files(dist)) {
  if (!/\.(js|html|css|json)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (secretPatterns[0].test(text)) fail(`A secret key was found in ${file}.`);
  if (/BEGIN (EC )?PRIVATE KEY/.test(text)) fail(`A private key was found in ${file}.`);
  for (const secret of serverSecrets)
    if (text.includes(secret)) fail(`A server secret was found in ${file}.`);
  for (const jwt of text.match(secretPatterns[1]) ?? []) {
    if (isSecretKey(jwt)) fail(`A service_role JWT was found in ${file}.`);
  }
}

/* ---------------- output ---------------- */

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "static"), { recursive: true });
cpSync(dist, join(out, "static"), { recursive: true, filter: (src) => !src.endsWith(".map") });

/** Route (under /api) → entry file. Each becomes its own Node function. */
const FUNCTIONS = {
  verify: { entry: "api-src/functions/verify.ts", maxDuration: 60, memory: 1024 },
  "comms/ticket": { entry: "api-src/functions/comms-ticket.ts", maxDuration: 10, memory: 256 },
  "voice/token": { entry: "api-src/functions/voice-token.ts", maxDuration: 10, memory: 256 },
  "comms/remove-member": {
    entry: "api-src/functions/comms-remove-member.ts",
    maxDuration: 20,
    memory: 256,
  },
};

for (const [route, spec] of Object.entries(FUNCTIONS)) {
  const fn = join(out, "functions", "api", `${route}.func`);
  mkdirSync(fn, { recursive: true });
  await build({
    entryPoints: [join(root, spec.entry)],
    outfile: join(fn, "index.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: "linked",
    legalComments: "none",
    // Some dependencies still call require(); give the ESM bundle one.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "warning",
    alias: Object.fromEntries(
      ["shared", "materials", "sim-core", "sim-runner", "reactor-components", "protocol"].map(
        (name) => [`@forgelab/${name}`, join(root, "packages", name, "src", "index.ts")],
      ),
    ),
  });
  writeFileSync(
    join(fn, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs22.x",
        handler: "index.mjs",
        launcherType: "Nodejs",
        shouldAddHelpers: false,
        shouldAddSourcemapSupport: true,
        maxDuration: spec.maxDuration,
        memory: spec.memory,
      },
      null,
      2,
    ),
  );
}

const supabaseOrigin = supabaseUrl === "" ? "" : new URL(supabaseUrl).origin;
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");
// Voice signalling (WebRTC media itself is not governed by connect-src).
const livekitUrl = (process.env.VITE_LIVEKIT_URL ?? "").trim();
const livekitOrigin = livekitUrl === "" ? "" : new URL(livekitUrl).origin;
const livekitHttp = livekitOrigin.replace(/^ws/, "http");
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseOrigin} https://*.supabase.co`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} https://*.supabase.co wss://*.supabase.co ${livekitOrigin} ${livekitHttp}`
    .replace(/\s+/g, " ")
    .trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = {
  "Content-Security-Policy": csp,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // The microphone is allowed for this origin only (voice channels); nothing else.
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const config = {
  version: 3,
  routes: [
    { src: "/(.*)", headers: securityHeaders, continue: true },
    {
      src: "/assets/(.*)",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      continue: true,
    },
    { handle: "filesystem" },
    // Unknown API paths are 404s, never the SPA.
    { src: "/api/(.*)", status: 404, dest: "/404-api" },
    // Every other path is a client-side route.
    { src: "/(.*)", headers: { "Cache-Control": "no-cache" }, dest: "/index.html" },
  ],
};
writeFileSync(join(out, "config.json"), JSON.stringify(config, null, 2));

console.log(`✓ Build Output written to ${out}`);
