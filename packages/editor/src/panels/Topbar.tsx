import { useState } from "react";
import { serializeScene } from "@engine/core";
import { sceneRootsStore, editorSceneHandleStore } from "../store/editorStore.js";
import { saveScene, loadScene as loadPersistedScene } from "../persistence/ScenePersistence.js";
import { connectionStore, connect, disconnect } from "../network/collabClient.js";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/**
 * Topbar — bottoni Save/Load (Fase 5B.3, chiude la Fase 5B) + bottone
 * Connect/Disconnect (Fase 6B.client-1, editor collaborativo Colyseus).
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
 *
 * Connect/Disconnect legge `connectionStore` (network/collabClient.ts):
 * un solo bottone che alterna testo/azione in base allo stato
 * (idle/error → "Connect", connecting → disabilitato, connected →
 * "Disconnect"). Nessuna UI di sessione/presence qui (Fase 6B.client-2) —
 * solo lo stato della connessione stessa, stesso stile piatto di Save/Load.
 */
export function Topbar(): JSX.Element {
  const handle = editorSceneHandleStore.useValue();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const connection = connectionStore.useValue();

  const ready = handle !== null;
  const busy = status.kind === "busy";
  const connecting = connection.status === "connecting";

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

  async function onToggleConnection(): Promise<void> {
    if (connection.status === "connected") {
      await disconnect();
    } else {
      await connect();
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
        <button
          type="button"
          className="topbar-button"
          disabled={connecting}
          onClick={() => void onToggleConnection()}
        >
          {connection.status === "connected" ? "Disconnect" : connecting ? "Connecting…" : "Connect"}
        </button>
      </div>
      {connection.status === "error" && (
        <span className="topbar-status topbar-status-error" role="alert">
          {`Connessione fallita: ${connection.message}`}
        </span>
      )}
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
