import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = Number(process.env.RUIS_PORT ?? 5178);

export default defineConfig({
  root: "src/editor",
  publicDir: false,
  plugins: [react()],
  build: { outDir: "../../dist/editor", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { "/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } },
  },
  test: {
    root: ".",
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
} as any);
