import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const base = env.VITE_BASE_PATH || "/";
  if (env.VITE_API_MODE === "pages") {
    let api: URL;
    try { api = new URL(env.VITE_API_BASE_URL); }
    catch { throw new Error("VITE_API_BASE_URL ต้องเป็น HTTPS origin ของ Netlify"); }
    if (api.protocol !== "https:" || api.origin !== env.VITE_API_BASE_URL || !/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base)) {
      throw new Error("Pages ต้องกำหนด VITE_API_BASE_URL และ VITE_BASE_PATH ให้ถูกต้อง");
    }
  }
  return {
  base,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request) =>
            request.setHeader("Origin", "http://127.0.0.1:8765"),
          );
        },
      },
    },
  },
  };
});
