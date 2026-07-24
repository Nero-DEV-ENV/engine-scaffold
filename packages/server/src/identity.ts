/**
 * identity.ts — Fase 6B.client-2: generazione dell'identità leggera
 * (nome+colore) assegnata a ogni client al join di `editor_room`.
 *
 * Nome: l'utente può fornire il proprio (owner della propria identità, come
 * in Unreal Multi-User Editing) tramite l'opzione `displayName` passata a
 * `joinOrCreate` lato client — sanificato qui (trim + cap lunghezza). Se
 * assente/vuoto dopo la sanificazione, fallback a generazione procedurale
 * aggettivo+animale (stile "Volpe Curiosa", coerente con l'esempio del
 * documento di sessione) — deciso esplicitamente con l'utente: il nome è
 * dell'utente quando lo fornisce, mai forzato dal server in quel caso.
 *
 * Colore: sempre assegnato dal server da una palette fissa di colori ben
 * distinguibili — mai scelto dal client. Evita collisioni con i colori già
 * in uso dai client connessi quando la palette ha ancora colori liberi;
 * altrimenti (più client connessi che colori in palette) cicla sulla
 * palette in base al numero di client già connessi, assegnazione
 * deterministica anche in questo caso limite invece che casuale.
 */

const MAX_DISPLAY_NAME_LENGTH = 24;

const ADJECTIVES = [
  "Curiosa",
  "Veloce",
  "Silenziosa",
  "Audace",
  "Astuta",
  "Instancabile",
  "Vivace",
  "Intrepida",
  "Serena",
  "Sveglia",
  "Tenace",
  "Guizzante",
] as const;

const ANIMALS = [
  "Volpe",
  "Lince",
  "Falco",
  "Lontra",
  "Airone",
  "Tasso",
  "Martora",
  "Gazza",
  "Faina",
  "Upupa",
  "Riccio",
  "Cinciallegra",
] as const;

/**
 * Palette fissa di colori esadecimali ben distinguibili fra loro (stessa
 * famiglia cromatica già usata altrove nel progetto per i colori demo delle
 * MeshRenderer — vedi createEditorScene.ts — non un caso, per coerenza
 * visiva con il resto dell'editor).
 */
export const COLOR_PALETTE = [
  "#e0663f",
  "#4f8ef7",
  "#5fb75f",
  "#c968d6",
  "#e0a63f",
  "#3fc7c7",
  "#d6486e",
  "#8a68d6",
  "#6bbf3f",
  "#e04f9e",
  "#3f8ee0",
  "#bf9f3f",
] as const;

function randomFrom<T>(items: readonly T[]): T {
  const index = Math.floor(Math.random() * items.length);
  // Non-null: `index` è sempre in [0, items.length) e items non è mai vuoto
  // (entrambe le liste sopra sono costanti letterali non vuote).
  return items[index]!;
}

/** Genera un nome procedurale (animale+aggettivo), usato quando il client non ne fornisce uno valido. */
export function generateProceduralName(): string {
  return `${randomFrom(ANIMALS)} ${randomFrom(ADJECTIVES)}`;
}

/**
 * Sanifica un `displayName` fornito dal client: trim + cap a
 * MAX_DISPLAY_NAME_LENGTH caratteri. Ritorna null se il valore non è una
 * stringa o resta vuoto dopo il trim — il chiamante (`resolveDisplayName`)
 * ricade sulla generazione procedurale in quel caso.
 */
export function sanitizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Risolve il nome finale da assegnare a un client: quello fornito (sanificato) o, in mancanza, uno generato proceduralmente. */
export function resolveDisplayName(raw: unknown): string {
  return sanitizeDisplayName(raw) ?? generateProceduralName();
}

/**
 * Sceglie un colore dalla palette per un nuovo client, evitando collisioni
 * con `usedColors` (i colori già assegnati ai client attualmente connessi)
 * quando la palette ha ancora colori liberi.
 */
export function pickColor(usedColors: ReadonlySet<string>): string {
  const free = COLOR_PALETTE.find((color) => !usedColors.has(color));
  if (free) return free;
  // Tutti i colori della palette sono già in uso (più client connessi che
  // colori disponibili): cicla in base al numero di client già connessi,
  // invece di un pick casuale, per restare deterministico anche in questo
  // caso limite.
  return COLOR_PALETTE[usedColors.size % COLOR_PALETTE.length]!;
}
