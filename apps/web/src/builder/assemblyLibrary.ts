import { type AssemblyFileV2, parseAssemblyFile } from "@forgelab/sim-core";
import { safeStorage } from "../lib/storage.js";

/**
 * The player's own assemblies, kept in this browser: pieces of designs saved to place
 * again (a cooling skid, a coil module, a blanket sector). Each is an ordinary assembly
 * file, validated by sim-core on every read; anything that no longer parses is dropped
 * rather than half-loaded. Sharing them through the community is a later step.
 */
export interface SavedAssembly {
  readonly id: string;
  readonly name: string;
  readonly savedAtIso: string;
  readonly parts: number;
  readonly file: AssemblyFileV2;
}

const KEY = "forgelab.assemblies.v1";
/** Kept small: local storage is a few megabytes and designs share it. */
export const MAX_SAVED_ASSEMBLIES = 40;

let cache: readonly SavedAssembly[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly SavedAssembly[] {
  const raw = safeStorage.getJson<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): SavedAssembly[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e["id"] !== "string" || typeof e["name"] !== "string") return [];
    try {
      const file = parseAssemblyFile(e["file"]);
      return [
        {
          id: e["id"],
          name: e["name"].slice(0, 80),
          savedAtIso: typeof e["savedAtIso"] === "string" ? e["savedAtIso"] : "",
          parts: file.components.length,
          file,
        },
      ];
    } catch {
      return [];
    }
  });
}

export const assemblyLibrary = {
  list(): readonly SavedAssembly[] {
    cache ??= read();
    return cache;
  },
  /** Saves a new assembly; returns false when storage refused it (full or disabled). */
  add(name: string, file: AssemblyFileV2): boolean {
    const entry: SavedAssembly = {
      id: `asm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: name.trim().slice(0, 80) || file.name,
      savedAtIso: new Date().toISOString(),
      parts: file.components.length,
      file: { ...file, name: name.trim().slice(0, 80) || file.name },
    };
    const next = [entry, ...assemblyLibrary.list()].slice(0, MAX_SAVED_ASSEMBLIES);
    if (!safeStorage.setJson(KEY, next)) return false;
    cache = next;
    for (const l of listeners) l();
    return true;
  },
  remove(id: string): void {
    const next = assemblyLibrary.list().filter((a) => a.id !== id);
    safeStorage.setJson(KEY, next);
    cache = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
