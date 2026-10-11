import { useSyncExternalStore } from "react";

/**
 * Optional photographic assets (HDRIs, PBR textures) served from the deployment's asset
 * bucket — a Cloudflare R2 bucket's public origin in VITE_ASSET_BASE_URL. The bucket holds
 * `manifest.json` (written by scripts/assets/fetch-polyhaven.mjs) and the files it names.
 *
 * Presentation only, and always optional: without the variable, or while the files load,
 * or if the bucket is unreachable, the hall stays procedural. Paths in the manifest must be
 * plain relative keys inside the bucket; anything else is ignored.
 */
export interface HdriAsset {
  readonly kind: "hdri";
  readonly url: string;
  readonly name: string;
  readonly authors: readonly string[];
  readonly license: string;
  readonly source: string;
}

export interface TextureAsset {
  readonly kind: "texture";
  /** three.js material slot → absolute URL. */
  readonly maps: Readonly<Partial<Record<"map" | "normalMap" | "roughnessMap", string>>>;
  /** Metres covered by one tile of the texture. */
  readonly tileM: number;
  readonly name: string;
  readonly authors: readonly string[];
  readonly license: string;
  readonly source: string;
}

export interface AssetManifest {
  readonly hdri: Readonly<Record<string, HdriAsset>>;
  readonly textures: Readonly<Record<string, TextureAsset>>;
}

export function assetBaseUrl(
  source: Partial<Record<string, string | undefined>> = import.meta.env,
): string | null {
  const raw = (source["VITE_ASSET_BASE_URL"] ?? "").trim().replace(/\/+$/, "");
  if (raw === "") return null;
  return /^https:\/\/[^/\s]+(\/[^\s]*)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(
    raw,
  )
    ? raw
    : null;
}

/** A key inside the bucket: relative, no scheme, no parent segments. */
function safeKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length < 300 &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.split("/").includes("..") &&
    !value.startsWith("/")
  );
}

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.slice(0, 200) : fallback;
const names = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 10) : [];

/** Validates a manifest and resolves its keys against the bucket's base URL. */
export function parseAssetManifest(input: unknown, base: string): AssetManifest {
  const hdri: Record<string, HdriAsset> = {};
  const textures: Record<string, TextureAsset> = {};
  const assets =
    typeof input === "object" && input !== null
      ? (input as { assets?: unknown }).assets
      : undefined;
  if (typeof assets !== "object" || assets === null) return { hdri, textures };
  for (const [slot, raw] of Object.entries(assets as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const a = raw as Record<string, unknown>;
    const meta = {
      name: text(a["name"], slot),
      authors: names(a["authors"]),
      license: text(a["license"]),
      source: text(a["source"]),
    };
    if (a["kind"] === "hdri" && safeKey(a["url"])) {
      hdri[slot] = { kind: "hdri", url: `${base}/${a["url"]}`, ...meta };
    } else if (a["kind"] === "texture" && typeof a["maps"] === "object" && a["maps"] !== null) {
      const maps: Partial<Record<"map" | "normalMap" | "roughnessMap", string>> = {};
      for (const slotName of ["map", "normalMap", "roughnessMap"] as const) {
        const key = (a["maps"] as Record<string, unknown>)[slotName];
        if (safeKey(key)) maps[slotName] = `${base}/${key}`;
      }
      const tileM = typeof a["tileM"] === "number" && a["tileM"] > 0 ? a["tileM"] : 1;
      if (maps.map !== undefined) textures[slot] = { kind: "texture", maps, tileM, ...meta };
    }
  }
  return { hdri, textures };
}

let manifest: AssetManifest | null = null;
let requested = false;
const listeners = new Set<() => void>();

function request(): void {
  if (requested || typeof window === "undefined") return;
  requested = true;
  const base = assetBaseUrl();
  if (base === null) return;
  fetch(`${base}/manifest.json`, { credentials: "omit" })
    .then((res) => (res.ok ? res.json() : null))
    .then((json: unknown) => {
      if (json === null) return;
      manifest = parseAssetManifest(json, base);
      for (const l of listeners) l();
    })
    .catch(() => {
      // Unreachable bucket: stay procedural.
    });
}

/** The asset manifest once loaded, else null (and null forever without a bucket). */
export function useAssetManifest(): AssetManifest | null {
  return useSyncExternalStore(
    (listener) => {
      request();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => manifest,
    () => null,
  );
}
