import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import { makeWorld, placeBlock } from "@forgelab/test-utils";
import { type SimulationWorld } from "./index.js";

const SIM_CORE_SRC = dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = join(SIM_CORE_SRC, "..", "..");

/**
 * Strips comments so the scans below judge code, not prose. A doc comment that says the
 * word "colour" while explaining that sim-core has no colours is not a violation.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(full);
    }
  };
  walk(root);
  return found;
}

/**
 * These tests are the enforcement behind the rule in docs/ARCHITECTURE.md: the simulation
 * is the authority and it does not know that a renderer exists. A lint rule can be
 * disabled inline; this cannot.
 */
describe("simulation / rendering separation", () => {
  const simulationPackages = [
    "shared",
    "materials",
    "sim-core",
    "reactor-components",
    "sim-runner",
  ];

  it("never imports React, Three.js or a renderer in any simulation package", () => {
    const forbidden = /from\s+["'](react|react-dom|three|@react-three\/[^"']+)["']/;
    const offenders: string[] = [];

    for (const pkg of simulationPackages) {
      for (const file of sourceFiles(join(PACKAGES_DIR, pkg, "src"))) {
        if (forbidden.test(codeOf(file))) offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("never touches the DOM or browser-only globals in any simulation package", () => {
    // `@forgelab/sim-core/rapier` is the one module allowed a dynamic import, and even
    // that is of a physics library rather than anything browser-specific.
    const forbidden = /\b(document|window|localStorage|navigator|requestAnimationFrame)\b/;
    const offenders: string[] = [];

    for (const pkg of simulationPackages) {
      for (const file of sourceFiles(join(PACKAGES_DIR, pkg, "src"))) {
        if (forbidden.test(codeOf(file))) offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("never uses a non-deterministic source inside the simulation packages", () => {
    const forbidden = /\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/;
    const offenders: string[] = [];

    for (const pkg of simulationPackages) {
      for (const file of sourceFiles(join(PACKAGES_DIR, pkg, "src"))) {
        if (forbidden.test(codeOf(file))) offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps presentation concepts such as colour out of sim-core", () => {
    // Utilization is stored as a number and classified as a status; what colour a status
    // is drawn in belongs to the workspace, not to the physics.
    const forbidden = /\b(color|colour|hex|rgba?\(|#[0-9a-fA-F]{6}\b)/;
    const offenders: string[] = [];

    for (const file of sourceFiles(SIM_CORE_SRC)) {
      if (forbidden.test(codeOf(file))) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("runs a full simulation with no DOM present", () => {
    expect(typeof globalThis).toBe("object");
    expect("document" in globalThis).toBe(false);
    expect("window" in globalThis).toBe(false);

    const world = makeWorld();
    placeBlock(world, { id: "block", positionM: vec3(0, 30, 0) });
    world.stepMany(120);
    expect(world.requireComponent("block").state.physical.positionM.y).toBeLessThan(30);
  });

  it("exposes exactly one way to advance time and one way to observe state", () => {
    const world: SimulationWorld = makeWorld();
    const before = world.tick;
    world.step();
    expect(world.tick).toBe(before + 1);

    const snapshot = world.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    // A snapshot is a value, not a handle: holding one cannot mutate the simulation.
    expect(() => {
      (snapshot as { tick: number }).tick = 999;
    }).toThrowError();
    expect(world.getSnapshot().tick).toBe(before + 1);
  });

  it("hands out frozen components so a renderer cannot write back into the simulation", () => {
    const world = makeWorld();
    placeBlock(world, { id: "block", positionM: vec3(0, 10, 0) });
    const component = world.getSnapshot().components[0]!;

    expect(Object.isFrozen(component)).toBe(true);
    expect(Object.isFrozen(component.state)).toBe(true);
    expect(Object.isFrozen(component.state.physical.positionM)).toBe(true);
  });
});
