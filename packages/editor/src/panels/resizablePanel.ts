/**
 * Fase 9 — logica pura per il ridimensionamento via drag della larghezza
 * di Hierarchy (richiesto dall'utente: "draggabile in larghezza"),
 * estratta a sé dal wiring DOM (pointerdown/pointermove/pointerup in
 * App.tsx), stesso pattern già usato per `resolveShortcutAction`
 * (shortcuts/globalShortcuts.ts) e `buildSceneContextMenuItems`
 * (scene/contextMenuItems.ts): la logica pura si testa, il wiring
 * DOM/React no (vedi convenzioni di progetto).
 */
export const HIERARCHY_DEFAULT_WIDTH_PX = 220;
export const HIERARCHY_MIN_WIDTH_PX = 160;
export const HIERARCHY_MAX_WIDTH_PX = 480;

/** Vincola `width` all'intervallo [min, max] incluso. */
export function clampPanelWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, width));
}
