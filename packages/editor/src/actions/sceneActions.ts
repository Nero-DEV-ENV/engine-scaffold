import { serializeScene } from "@engine/core";
import type { SceneData } from "@engine/core";
import { saveScene, loadScene as loadPersistedScene } from "../persistence/ScenePersistence.js";
import { sceneRootsStore, editorSceneHandleStore, saveLoadStatusStore, diskSaveLoadStatusStore } from "../store/editorStore.js";
import { writeProjectFile, fetchProjectFile } from "../network/projectFolderClient.js";

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

/**
 * Fase 10F — nome fisso del file scena dentro la project folder aperta
 * (punto 2 confermato dall'utente: un percorso convenzionale fisso alla
 * radice, non un campo scelto dall'utente né un "file corrente" tracciato
 * per sessione). Esportato perché sia `saveSceneToDisk` che
 * `loadSceneFromDiskIntoEditor` sotto devono concordare sullo stesso nome.
 */
export const SCENE_FILE_NAME = "scene.json";

/**
 * Fase 10F — salva la scena corrente come file JSON dentro la project
 * folder aperta (via host-agent, `POST /project/file`), AFFIANCO a
 * `saveCurrentScene` sopra (IndexedDB) e non al suo posto (punto 1
 * confermato dall'utente): stesso `serializeScene`/`SceneData` così come
 * sono già (punto 3), nessuna integrazione speciale con lo stato
 * collaborativo (punto 4 — `sceneRootsStore` è già la vista locale
 * mantenuta sincronizzata in tempo reale da `network/collabClient.ts`, vedi
 * Fase 6B-6D). Stato dedicato `diskSaveLoadStatusStore` (non
 * `saveLoadStatusStore`, che resta solo per IndexedDB). Il chiamante (UI)
 * è responsabile di disabilitare il bottone quando nessuna project folder
 * è aperta — qui ci si limita a riflettere l'esito reale della scrittura
 * (fallisce comunque silenziosamente lato host-agent se non c'è una root
 * aperta, vedi `ProjectFolderSession.writeFile`).
 */
export async function saveSceneToDisk(): Promise<void> {
  diskSaveLoadStatusStore.set({ kind: "busy" });
  try {
    const roots = sceneRootsStore.get();
    const data = serializeScene(roots);
    const written = await writeProjectFile(SCENE_FILE_NAME, JSON.stringify(data));
    if (!written) {
      diskSaveLoadStatusStore.set({
        kind: "error",
        message: "Salvataggio su disco fallito: nessuna project folder aperta, o errore host-agent.",
      });
      return;
    }
    diskSaveLoadStatusStore.set({ kind: "success", message: "Scena salvata su disco." });
  } catch (error) {
    diskSaveLoadStatusStore.set({
      kind: "error",
      message: `Salvataggio su disco fallito: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Fase 10F — carica `scene.json` dalla project folder aperta (via
 * host-agent, `GET /project/file`) e la applica incondizionatamente
 * all'editor (punto 5 confermato dall'utente: nessun dirty flag esiste
 * oggi, nessuna conferma richiesta — stesso comportamento già di
 * `loadPersistedSceneIntoEditor` sopra). Nessuna validazione oltre
 * `JSON.parse`: un file corrotto o con una shape inattesa produce un
 * errore leggibile in `diskSaveLoadStatusStore` invece di un crash silente.
 */
export async function loadSceneFromDiskIntoEditor(): Promise<void> {
  const handle = editorSceneHandleStore.get();
  if (!handle) return;
  diskSaveLoadStatusStore.set({ kind: "busy" });
  try {
    const result = await fetchProjectFile(SCENE_FILE_NAME);
    if (!result) {
      diskSaveLoadStatusStore.set({ kind: "empty" });
      return;
    }
    const text = new TextDecoder("utf-8").decode(result.data);
    const data = JSON.parse(text) as SceneData;
    handle.loadScene(data);
    diskSaveLoadStatusStore.set({ kind: "success", message: "Scena caricata da disco." });
  } catch (error) {
    diskSaveLoadStatusStore.set({
      kind: "error",
      message: `Caricamento da disco fallito: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
