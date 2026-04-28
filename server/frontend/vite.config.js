import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const isMock = mode === "mock";

  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
    resolve: isMock
      ? {
          alias: [
            {
              find: path.resolve(__dirname, "src/api.js"),
              replacement: path.resolve(__dirname, "src/api.mock.js"),
            },
            {
              find: path.resolve(__dirname, "src/utils/supabase.js"),
              replacement: path.resolve(__dirname, "src/utils/supabase.mock.js"),
            },
          ],
        }
      : {},
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/lightweight-charts") || id.includes("node_modules/fancy-canvas")) {
              return "charts";
            }
            if (id.includes("node_modules/@supabase") || id.includes("node_modules/isows") || id.includes("node_modules/ws")) {
              return "supabase";
            }
            if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
              return "react";
            }
          },
        },
      },
    },
  };
});
