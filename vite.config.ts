import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Local development mode (`npm run local`) serves the site against the API in
// `localdev/` instead of the hosted backend. The flag is set by the launcher and
// read at build time — see `src/lib/cloud.ts`. Everything below it is unchanged.
const localBackend = process.env.VITE_LOCAL_BACKEND === "1"
const localApi = `http://127.0.0.1:${process.env.LOCAL_API_PORT || 54321}`

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // The published app is reverse-proxied from a host Vite does not know about.
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT) || 5173,
    ...(localBackend
      ? { proxy: { "/api": { target: localApi, changeOrigin: true } } }
      : {}),
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT) || 4173,
  },
});
