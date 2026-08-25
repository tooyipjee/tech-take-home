import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here("."),
  plugins: [react()],
  resolve: {
    alias: {
      "@platform/sdk": here("../../packages/sdk/src/index.ts"),
      "@platform/app-kit": here("../../packages/app-kit/src/index.ts"),
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    proxy: { "/api": "http://localhost:8080" },
  },
});
