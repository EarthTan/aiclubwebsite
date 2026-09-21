import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The API is served by the Worker, so during UI work it is run beside this
// server (`npm run cf:api`, on 8787) and reached through the proxy below. That
// keeps `npm run dev` fast while every read and write still goes to real code.
const apiTarget = `http://127.0.0.1:${process.env.API_PORT || 8787}`

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
    // The deployed site is reverse-proxied from a host this server does not know.
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/media": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT) || 4173,
  },
});
