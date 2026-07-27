/**
 * Fase 6C.1 — opzioni del bottone "+" di Hierarchy.tsx (Empty/Cube/Sphere/
 * Plane, gli stessi `kind` accettati da `EditorSceneHandle.addGameObject`).
 * Estratto in un modulo condiviso in Fase 8: il menu contestuale su area
 * vuota (Hierarchy e Viewport, vedi scene/contextMenuItems.ts) deve offrire
 * ESATTAMENTE le stesse opzioni, non una lista duplicata che rischierebbe
 * di disallinearsi in futuro.
 */
export const ADD_GAME_OBJECT_OPTIONS: ReadonlyArray<{
  kind: "empty" | "box" | "sphere" | "plane";
  label: string;
}> = [
  { kind: "empty", label: "Empty" },
  { kind: "box", label: "Cube" },
  { kind: "sphere", label: "Sphere" },
  { kind: "plane", label: "Plane" },
];
