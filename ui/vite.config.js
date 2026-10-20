import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiTarget = `http://127.0.0.1:${process.env.COPILOT_INSIGHTS_API_PORT || "3002"}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "..", "src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, request) => {
            if (request.headers.origin === `http://${request.headers.host}`) {
              proxyRequest.setHeader("Origin", apiTarget);
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts")) return "charts";
          if (id.includes("react-router")) return "router";
          if (id.includes("react")) return "react-vendor";
          return "vendor";
        },
      },
    },
  },
});
