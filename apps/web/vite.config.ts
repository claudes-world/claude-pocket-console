import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

const gitVersion = (() => {
  try {
    return execSync("git describe --tags --always").toString().trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion),
  },
  server: {
    port: 58830,
    proxy: {
      "/api": "http://localhost:38830",
      "/ws": {
        target: "ws://localhost:38830",
        ws: true,
      },
    },
  },
});
