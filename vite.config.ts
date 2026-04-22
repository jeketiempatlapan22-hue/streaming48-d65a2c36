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
      devOptions: {
        enabled: false,
      },
      includeAssets: ["favicon.png", "logo.png", "robots.txt", "pwa-192x192.png", "pwa-512x512.png", "pwa-maskable-512x512.png"],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [
          /^\/~oauth/,
          /^\/admin/,
          /^\/login/,
          /^\/auth/,
          /^\/reset-password/,
        ],
        globPatterns: ["**/*.{js,css,ico,png,svg,webp,woff2}"],
        globIgnores: ["**/index.html"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // HTML navigations: always try network first so updated UI ships fast.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-pages",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/(auth|realtime|functions|rest\/v1\/rpc)\/.*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
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
        // Re-use existing PWA window when user opens a token link instead of opening a new instance.
        launch_handler: { client_mode: ["focus-existing", "auto"] },
        // Open in-scope links from other apps directly inside the installed PWA.
        handle_links: "preferred",
        // Treat these production domains as part of the same PWA scope so /live?t=... links
        // tapped from WhatsApp/browser launch the installed app instead of a browser tab.
        scope_extensions: [
          { origin: "https://realtime48stream.my.id" },
          { origin: "https://www.realtime48stream.my.id" },
          { origin: "https://realtime48show.my.id" },
          { origin: "https://www.realtime48show.my.id" },
          { origin: "https://streaming48.lovable.app" },
        ],
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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
