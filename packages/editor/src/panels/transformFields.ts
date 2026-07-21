/**
 * transformFields.ts — logica pura (nessuna dipendenza da React/DOM/three.js
 * a runtime) usata da Inspector.tsx per i campi numerici di
 * position/rotation/scale. Estratta in un modulo a parte per poterla
 * testare in Vitest senza montare componenti né toccare three.js — stesso
 * approccio già seguito da scene/hierarchy.ts e store/editorStore.ts nelle
 * fasi precedenti (fake minimali, zero dipendenza a runtime dove possibile).
 */

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** Converte radianti (Transform.eulerAngles, fonte di verità) in gradi (valore mostrato nel campo Inspector). */
export function radToDeg(radians: number): number {
  return radians * RAD_TO_DEG;
}

/** Converte gradi (valore digitato dall'utente nel campo Inspector) in radianti (da scrivere su Transform.eulerAngles). */
export function degToRad(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/**
 * Arrotonda un numero per la sola visualizzazione in un campo Inspector —
 * evita di mostrare rumore in virgola mobile (es. 0.9999999997) dopo una
 * conversione radianti↔gradi o dopo un drag del gizmo. Non va usato per lo
 * stato reale del Transform: solo per il valore mostrato nell'input quando
 * non ha il focus.
 */
export function roundForDisplay(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Interpreta il testo digitato in un campo numerico dell'Inspector.
 * Restituisce `null` per un input non ancora un numero valido (stringa
 * vuota, solo "-", ecc. — stati intermedi normali mentre l'utente digita)
 * invece di `NaN`, così il chiamante può scegliere di non scrivere ancora
 * sul Transform senza dover ripetere `Number.isNaN` ad ogni sito di
 * chiamata.
 */
export function parseNumericInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}
