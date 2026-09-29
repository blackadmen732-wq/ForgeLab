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
      "@forgelab/sim-runner": pkg("sim-runner"),
      "@forgelab/reactor-components": pkg("reactor-components"),
    },
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1400,
  },
  server: {
    port: 5173,
    // /api/verify runs as a server function; `pnpm dev:api` serves it on :3000.
    proxy: { "/api": process.env.FORGELAB_API_URL ?? "http://localhost:3000" },
  },
});
