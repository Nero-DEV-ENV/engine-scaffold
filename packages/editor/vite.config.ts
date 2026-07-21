import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Fase 4A: shell React/Vite. Il plugin PWA (manifest + service worker)
// arriva in Fase 4D — aggiungerlo qui in anticipo introdurrebbe superficie
// non ancora verificata in questa sotto-fase.
export default defineConfig({
  plugins: [react()],
});
