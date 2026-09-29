import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * Simulation tests run in a plain Node environment on purpose: `@forgelab/sim-core`
 * must remain usable without a DOM, without React and without a renderer.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@forgelab/shared": pkg("shared"),
      "@forgelab/materials": pkg("materials"),
      "@forgelab/sim-core": pkg("sim-core"),
      "@forgelab/reactor-components": pkg("reactor-components"),
      "@forgelab/test-utils": pkg("test-utils"),
      "@forgelab/sim-runner": pkg("sim-runner"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
    reporters: ["default"],
  },
});
