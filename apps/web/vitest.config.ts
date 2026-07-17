import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vite injects __APP_VERSION__ via `define` in vite.config.ts; mirror it
  // here so components referencing it render under vitest (App mounts
  // VersionBadge unconditionally since WORLD-416).
  define: {
    __APP_VERSION__: JSON.stringify("v0.0.0-test"),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
