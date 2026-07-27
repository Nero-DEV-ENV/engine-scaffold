import { serializeScene } from "@engine/core";
import { saveScene, loadScene as loadPersistedScene } from "../persistence/ScenePersistence.js";
import { sceneRootsStore, editorSceneHandleStore, saveLoadStatusStore } from "../store/editorStore.js";

/**
 * Fase 8 — logica di Save/Load estratta da Topbar.tsx (dove viveva come
 * `onSave`/`onLoad` locali) perché ora ha DUE punti d'ingresso: il click
 * dei bottoni Save/Load in Topbar.tsx e la scorciatoia da tastiera
 * Ctrl+S/Ctrl+O (shortcuts/globalShortcuts.ts). Nessuna logica di dominio
 * nuova rispetto a quanto già esisteva — stesso `serializeScene`, stesso
 * `ScenePersistence.ts`, stesso `EditorSceneHandle.loadScene` — solo
 * spostata qui perché entrambi i punti d'ingresso possano condividerla
 * insieme allo stato `saveLoadStatusStore` (altrimenti un salvataggio da
 * tastiera non aggiornerebbe il messaggio mostrato da Topbar.tsx, che
 * prima di questa fase leggeva solo il proprio `useState` locale).
 */

export async function saveCurrentScene(): Promise<void> {
  saveLoadStatusStore.set({ kind: "busy" });
  try {
    const roots = sceneRootsStore.get();
    const data = serializeScene(roots);
    await saveScene(data);
    saveLoadStatusStore.set({ kind: "success", message: "Scena salvata." });
  } catch (error) {
    saveLoadStatusStore.set({
      kind: "error",
      message: `Salvataggio fallito: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function loadPersistedSceneIntoEditor(): Promise<void> {
  const handle = editorSceneHandleStore.get();
  if (!handle) return;
  saveLoadStatusStore.set({ kind: "busy" });
  try {
    const data = await loadPersistedScene();
    if (!data) {
      saveLoadStatusStore.set({ kind: "empty" });
      return;
    }
    handle.loadScene(data);
    saveLoadStatusStore.set({ kind: "success", message: "Scena caricata." });
  } catch (error) {
    saveLoadStatusStore.set({
      kind: "error",
      message: `Caricamento fallito: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
