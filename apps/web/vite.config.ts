import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@forgelab/shared": pkg("shared"),
      "@forgelab/materials": pkg("materials"),
      "@forgelab/sim-core/rapier": fileURLToPath(
        new URL("../../packages/sim-core/src/dynamics/rapier-backend.ts", import.meta.url),
      ),
      "@forgelab/sim-core": pkg("sim-core"),
      "@forgelab/reactor-components": pkg("reactor-components"),
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
