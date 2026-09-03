import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

function getBasePath() {
  if (process.env.VITE_BASE_PATH) return process.env.VITE_BASE_PATH;
  if (!process.env.GITHUB_ACTIONS) return "/";

  const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const owner = process.env.GITHUB_REPOSITORY?.split("/")[0];
  if (!repository || !owner) return "/";

  return repository === `${owner}.github.io` ? "/" : `/${repository}/`;
}

export default defineConfig({
  base: getBasePath(),
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787"
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  },
  test: {
    environment: "node"
  }
});
