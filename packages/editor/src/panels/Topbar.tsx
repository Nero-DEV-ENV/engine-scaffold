import { useState } from "react";
import { serializeScene } from "@engine/core";
import { sceneRootsStore, editorSceneHandleStore } from "../store/editorStore.js";
import { saveScene, loadScene as loadPersistedScene } from "../persistence/ScenePersistence.js";
import { connectionStore, connect, disconnect, presenceStore, mySessionIdStore } from "../network/collabClient.js";

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
 * "Disconnect").
 *
 * Fase 6B.client-2 aggiunge:
 * - Un campo di testo per il proprio nome (nome scelto dall'utente stesso —
 *   "owner" della propria identità, coerente con Unreal Multi-User Editing
 *   — deciso con l'utente al posto di un dialog/modal dedicato, pattern
 *   assente in Topbar). Editabile solo PRIMA di connettersi: il nome è
 *   inviato una volta sola come opzione di join (vedi `connect` in
 *   collabClient.ts), cambiarlo dopo la connessione non avrebbe effetto
 *   finché non ci si riconnette, quindi il campo si disabilita a
 *   connessione avviata per non suggerire un comportamento che non esiste.
 *   Vuoto è un valore valido: il server ricade sulla generazione
 *   procedurale (vedi identity.ts lato server).
 * - Striscia presence (pallino colore + nome per ogni client connesso,
 *   incluso se stessi — marcato "(tu)" confrontando il sessionId con
 *   `mySessionIdStore`), letta da `presenceStore`.
 */
export function Topbar(): JSX.Element {
  const handle = editorSceneHandleStore.useValue();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const connection = connectionStore.useValue();
  const presence = presenceStore.useValue();
  const mySessionId = mySessionIdStore.useValue();
  const [displayNameInput, setDisplayNameInput] = useState("");

  const ready = handle !== null;
  const busy = status.kind === "busy";
  const connecting = connection.status === "connecting";
  const nameInputDisabled = connecting || connection.status === "connected";

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
      const trimmed = displayNameInput.trim();
      await connect(trimmed.length > 0 ? trimmed : undefined);
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
        <input
          type="text"
          className="topbar-name-input"
          placeholder="Il tuo nome (opzionale)"
          value={displayNameInput}
          disabled={nameInputDisabled}
          maxLength={24}
          onChange={(event) => setDisplayNameInput(event.target.value)}
        />
        <button
          type="button"
          className="topbar-button"
          disabled={connecting}
          onClick={() => void onToggleConnection()}
        >
          {connection.status === "connected" ? "Disconnect" : connecting ? "Connecting…" : "Connect"}
        </button>
      </div>
      {presence.size > 0 && (
        <div className="topbar-presence" aria-label="Client connessi">
          {Array.from(presence.entries()).map(([sessionId, info]) => (
            <span key={sessionId} className="presence-chip">
              <span className="presence-dot" style={{ backgroundColor: info.color }} />
              {info.name}
              {sessionId === mySessionId ? " (tu)" : ""}
            </span>
          ))}
        </div>
      )}
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
