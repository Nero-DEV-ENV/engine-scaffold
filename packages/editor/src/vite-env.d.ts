/// <reference types="vite/client" />

/**
 * Fase 6B.client-1 — variabile d'ambiente Vite per l'URL del server
 * Colyseus lato client (vedi network/collabClient.ts). Fallback a
 * `ws://localhost:2567` quando non impostata: l'editor deve continuare a
 * funzionare identico a oggi in sviluppo/uso in LAN finché il tunnel (Fase
 * 6F) non è attivo — quel giorno il valore effettivo arriverà
 * dinamicamente dal rendez-vous, non da questa variabile scritta a mano.
 */
interface ImportMetaEnv {
  readonly VITE_COLYSEUS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
