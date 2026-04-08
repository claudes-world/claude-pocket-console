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

// When served behind Caddy at `cpc.claude.do/dev/`, the Vite dev server must
// emit asset URLs with the `/dev/` prefix so that `/@vite/client`,
// `/src/main.tsx`, and `/@react-refresh` resolve through the same reverse
// proxy rule. Production builds (command === "build") keep the default
// absolute root so the built bundle is served directly at `cpc.claude.do/`.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === "serve" ? "/dev/" : "/",
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
}));
