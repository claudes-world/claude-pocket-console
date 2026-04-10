import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
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
    // Kill the eager `<link rel="modulepreload">` hint Vite emits for the
    // mermaid chunk. Mermaid is dynamically imported inside MermaidDiagram.tsx
    // and only needed when a markdown file actually contains a diagram, but
    // Vite auto-hoists dynamic-import targets into modulepreload hints, so
    // every cold start was downloading the 637 KB mermaid bundle for nothing.
    // `resolveDependencies` lets us filter that specific chunk out of the
    // preload list while leaving all other dynamic-import preloads alone.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !d.includes("mermaid")),
    },
    rollupOptions: {
      plugins:
        command === "build"
          ? [
              visualizer({
                template: "treemap",
                filename: "dist/bundle-stats.html",
                gzipSize: true,
                brotliSize: true,
              }),
            ]
          : [],
      output: {
        // Split heavy, rarely-changing vendor libraries into their own
        // content-hashed chunks so browsers can cache them across app-code
        // redeploys. These chunks only change when the corresponding package
        // version bumps, unlike the main app chunk which changes on every
        // deploy.
        manualChunks: {
          mermaid: ["mermaid"],
          "vendor-react": ["react", "react-dom", "react-dom/client"],
          "vendor-xterm": [
            "@xterm/xterm",
            "@xterm/addon-fit",
            "@xterm/addon-web-links",
          ],
          "vendor-marked": ["marked"],
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
