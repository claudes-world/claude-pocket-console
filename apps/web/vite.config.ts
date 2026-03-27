import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
