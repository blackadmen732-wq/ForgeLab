import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function imports(pkg: string): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        for (const m of readFileSync(full, "utf8").matchAll(
          /(?:from|import)\s*\(?\s*["']([^"'.][^"']*)["']/g,
        ))
          found.add(m[1]!);
      }
    }
  };
  walk(join(PACKAGES_DIR, pkg, "src"));
  return found;
}

/**
 * The communication layers stay separate (docs/COMMUNICATIONS.md): the protocol is a
 * leaf, presence/collaboration does not know about audio, voice does not know about the
 * project session, and none of them reach into the simulation — nor it into them.
 */
describe("communication package boundaries", () => {
  it("keeps @forgelab/protocol dependency-free", () => {
    expect([...imports("protocol")]).toEqual([]);
  });

  it("keeps multiplayer free of voice, the simulation and database clients", () => {
    expect([...imports("multiplayer")]).toEqual(["@forgelab/protocol"]);
  });

  it("keeps voice free of the project session, the simulation and database clients", () => {
    expect([...imports("voice")]).toEqual(["livekit-client"]);
  });

  it("keeps the simulation packages unaware of collaboration", () => {
    for (const pkg of ["shared", "materials", "sim-core", "reactor-components", "sim-runner"]) {
      const comms = [...imports(pkg)].filter((m) =>
        /^(@forgelab\/(protocol|multiplayer|voice)|livekit-client|@supabase\/)/.test(m),
      );
      expect(comms, pkg).toEqual([]);
    }
  });
});
