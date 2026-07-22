import { useState } from "react";
import { serializeScene } from "@engine/core";
import { sceneRootsStore, editorSceneHandleStore } from "../store/editorStore.js";
import { saveScene, loadScene as loadPersistedScene } from "../persistence/ScenePersistence.js";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/**
 * Topbar — bottoni Save/Load (Fase 5B.3, chiude la Fase 5B).
 *
 * Save legge `sceneRootsStore.get()` (i roots correnti, stessa fonte di
 * verità già usata da Hierarchy.tsx) — non serve l'handle per salvare.
 * Load invece deve invocare `EditorSceneHandle.loadScene()`, quindi dipende
 * da `editorSceneHandleStore`.
 *
 * Entrambi i bottoni restano disabilitati finché `editorSceneHandleStore`
 * è `null` (Viewport non ha ancora finito il bootstrap, o è smontato):
 * Viewport.tsx popola/svuota `sceneRootsStore` ed `editorSceneHandleStore`
 * sempre insieme, nello stesso effect (vedi Viewport.tsx), quindi usare la
 * sola presenza dell'handle come gate per entrambi i bottoni è corretto e
 * non richiede una sottoscrizione separata a `sceneRootsStore` qui — serve
 * solo `.get()` al momento del click, dentro `onSave`.
 */
export function Topbar(): JSX.Element {
  const handle = editorSceneHandleStore.useValue();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const ready = handle !== null;
  const busy = status.kind === "busy";

  async function onSave(): Promise<void> {
    setStatus({ kind: "busy" });
    try {
      const roots = sceneRootsStore.get();
      const data = serializeScene(roots);
      await saveScene(data);
      setStatus({ kind: "success", message: "Scena salvata." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Salvataggio fallito: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async function onLoad(): Promise<void> {
    if (!handle) return;
    setStatus({ kind: "busy" });
    try {
      const data = await loadPersistedScene();
      if (!data) {
        setStatus({ kind: "empty" });
        return;
      }
      handle.loadScene(data);
      setStatus({ kind: "success", message: "Scena caricata." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Caricamento fallito: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return (
    <header className="editor-topbar">
      <span className="editor-topbar-title">Engine Editor</span>
      <div className="topbar-actions">
        <button type="button" className="topbar-button" disabled={!ready || busy} onClick={() => void onSave()}>
          Save
        </button>
        <button type="button" className="topbar-button" disabled={!ready || busy} onClick={() => void onLoad()}>
          Load
        </button>
      </div>
      {(status.kind === "success" || status.kind === "empty" || status.kind === "error") && (
        <span
          className={status.kind === "error" ? "topbar-status topbar-status-error" : "topbar-status"}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.kind === "empty" ? "Nessuna scena salvata." : status.message}
        </span>
      )}
    </header>
  );
}
