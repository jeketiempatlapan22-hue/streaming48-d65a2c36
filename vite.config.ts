import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "logo.png", "robots.txt"],
      workbox: {
        // Skip waiting so the new SW activates immediately
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [
          /^\/~oauth/,
          /^\/admin/,
          /^\/login/,
          /^\/auth/,
          /^\/reset-password/,
        ],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Clean old caches on update
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // NEVER cache Supabase auth, realtime, functions
            urlPattern: /^https:\/\/.*\.supabase\.co\/(auth|realtime|functions|rest\/v1\/rpc)\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Supabase REST API - network first with short cache
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 },
            },
          },
          {
            // Images - cache first
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Supabase storage files - stale while revalidate
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "supabase-storage",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      manifest: {
        name: "RealTime48 — Streaming Platform",
        short_name: "RealTime48",
        description: "Platform streaming aman untuk M3U8, Cloudflare Stream & YouTube",
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/logo.png", sizes: "192x192", type: "image/png" },
          { src: "/logo.png", sizes: "512x512", type: "image/png" },
          { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        categories: ["entertainment", "video"],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
