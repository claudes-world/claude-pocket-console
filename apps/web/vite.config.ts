import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";

const gitVersion = (() => {
  try {
    return execSync("git describe --tags --always").toString().trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mermaid: ["mermaid"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["cpc.claude.do"],
    port: 58830,
    proxy: {
      "/api": "http://127.0.0.1:38830",
      "/ws": {
        target: "ws://127.0.0.1:38830",
        ws: true,
      },
    },
  },
});
