import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Fase 4D: PWA installabile. Strategia `generateSW` (default del plugin,
// non serve un service worker scritto a mano): Workbox precache degli
// asset statici generati dalla build (JS/CSS/HTML/icone), quindi
// pnpm build / pnpm dev:editor restano immutati per lo sviluppo — solo la
// build di produzione emette manifest.webmanifest + sw.js + registerSW.js.
// `registerType: "prompt"` (non "autoUpdate"): un editor visuale può avere
// lavoro non salvato nella scena in memoria quando arriva una nuova
// versione, quindi l'aggiornamento del service worker viene notificato
// all'utente (vedi useRegisterSW in PwaUpdateBanner.tsx) invece di
// ricaricare la pagina in autonomia.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon-192.png", "icon-512.png", "maskable-icon-512.png"],
      manifest: {
        name: "Engine Editor",
        short_name: "Editor",
        description: "Editor visuale per il motore three.js/@engine/core",
        // Coerente con lo sfondo scuro del Viewport/pannelli (#1b1d21, vedi App.css).
        theme_color: "#1b1d21",
        background_color: "#1b1d21",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache di tutti gli asset statici della build: l'editor deve
        // restare avviabile offline dopo la prima visita (requisito Fase 4D).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
      },
    }),
  ],
});