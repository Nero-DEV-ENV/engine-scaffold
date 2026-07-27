import { useEffect, useState } from "react";
import { editorSceneHandleStore, saveLoadStatusStore } from "../store/editorStore.js";
import { saveCurrentScene, loadPersistedSceneIntoEditor } from "../actions/sceneActions.js";
import { connectionStore, connect, disconnect, presenceStore, mySessionIdStore } from "../network/collabClient.js";
import { agentStateStore, ensureAgentMonitoring } from "../network/hostAgentClient.js";
import { TunnelDialog, type TunnelDialogVariant } from "./TunnelDialog.js";

/**
 * Topbar — bottoni Save/Load (Fase 5B.3, chiude la Fase 5B) + bottone
 * Connect/Disconnect (Fase 6B.client-1, editor collaborativo Colyseus).
 *
 * Fase 8: la logica di Save/Load stessa (prima `onSave`/`onLoad` locali +
 * `useState<Status>` qui) è stata spostata in `actions/sceneActions.ts` +
 * `saveLoadStatusStore` (store/editorStore.ts), perché ora ha un secondo
 * punto d'ingresso — la scorciatoia da tastiera Ctrl+S/Ctrl+O in
 * `shortcuts/globalShortcuts.ts` — che deve condividere lo stesso feedback
 * di stato mostrato qui sotto, non un proprio `useState` separato e
 * invisibile a questo componente. Questo componente resta comunque
 * l'unico posto che RENDE quello stato (messaggio/disabled dei bottoni).
 *
 * Entrambi i bottoni restano disabilitati finché `editorSceneHandleStore`
 * è `null` (Viewport non ha ancora finito il bootstrap, o è smontato):
 * Viewport.tsx popola/svuota `sceneRootsStore` ed `editorSceneHandleStore`
 * sempre insieme, nello stesso effect (vedi Viewport.tsx), quindi usare la
 * sola presenza dell'handle come gate per entrambi i bottoni è corretto e
 * non richiede una sottoscrizione separata a `sceneRootsStore` qui.
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
 *
 * Fase 6F.3.d aggiunge (decisione utente, punto aperto 3 — UNICA UI con
 * scelta esplicita locale/LAN vs tunnel): un selettore di modalità
 * accanto al bottone Connect/Disconnect. In modalità "Tunnel", cliccare
 * il bottone (quando non già connessi) apre `TunnelDialog` variante
 * "join" invece di chiamare `connect()` direttamente — è il dialog stesso
 * a chiamare `connect()` con un `transportOverride` una volta stabilita
 * la connessione WebRTC (vedi TunnelDialog.tsx). Una volta connessi
 * (locale/LAN o tunnel, indistinguibile da qui), il bottone
 * Disconnect/la striscia presence si comportano IDENTICI. Il bottone
 * "Ospita" (indipendente dal selettore di modalità: l'host non si
 * connette qui alla propria room, orchestrata dal dialog variante "host"
 * verso host-agent) resta disabilitato finché `agentStateStore` non è
 * "running" (decisione utente, Fase 6F.3.b DECISIONE 13 — il controllo è
 * responsabilità della UI, non del backend).
 */
export function Topbar(): JSX.Element {
  const handle = editorSceneHandleStore.useValue();
  const status = saveLoadStatusStore.useValue();
  const connection = connectionStore.useValue();
  const presence = presenceStore.useValue();
  const mySessionId = mySessionIdStore.useValue();
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [mode, setMode] = useState<"local" | "tunnel">("local");
  const [dialogVariant, setDialogVariant] = useState<TunnelDialogVariant | null>(null);
  const agentState = agentStateStore.useValue();

  useEffect(() => {
    // Idempotente (vedi hostAgentClient.ts) — ridondante con l'effect
    // equivalente di HostAgentPanel.tsx quando entrambi sono montati (App.tsx
    // li monta sempre insieme), ma tiene Topbar corretta anche se in futuro
    // HostAgentPanel non fosse più montato incondizionatamente.
    ensureAgentMonitoring();
  }, []);

  const ready = handle !== null;
  const busy = status.kind === "busy";
  const connecting = connection.status === "connecting";
  const nameInputDisabled = connecting || connection.status === "connected";
  const modeDisabled = nameInputDisabled;
  const hostReady = agentState.status === "running";

  async function onToggleConnection(): Promise<void> {
    if (connection.status === "connected") {
      await disconnect();
      return;
    }
    if (mode === "tunnel") {
      setDialogVariant("join");
      return;
    }
    const trimmed = displayNameInput.trim();
    await connect(trimmed.length > 0 ? trimmed : undefined);
  }

  return (
    <header className="editor-topbar">
      <span className="editor-topbar-title">Engine Editor</span>
      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-button"
          disabled={!ready || busy}
          onClick={() => void saveCurrentScene()}
        >
          Save
        </button>
        <button
          type="button"
          className="topbar-button"
          disabled={!ready || busy}
          onClick={() => void loadPersistedSceneIntoEditor()}
        >
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
        <div className="topbar-mode-toggle" role="group" aria-label="Modalità di connessione">
          <button
            type="button"
            className={`topbar-mode-button${mode === "local" ? " topbar-mode-button-active" : ""}`}
            disabled={modeDisabled}
            onClick={() => setMode("local")}
          >
            Locale/LAN
          </button>
          <button
            type="button"
            className={`topbar-mode-button${mode === "tunnel" ? " topbar-mode-button-active" : ""}`}
            disabled={modeDisabled}
            onClick={() => setMode("tunnel")}
          >
            Tunnel
          </button>
        </div>
        <button
          type="button"
          className="topbar-button"
          disabled={connecting}
          onClick={() => void onToggleConnection()}
        >
          {connection.status === "connected" ? "Disconnect" : connecting ? "Connecting…" : "Connect"}
        </button>
        <button
          type="button"
          className="topbar-button"
          disabled={!hostReady}
          title={hostReady ? "" : "Richiede il server locale in esecuzione (vedi pannello \"Server locale\")"}
          onClick={() => setDialogVariant("host")}
        >
          Ospita
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
      {dialogVariant !== null && (
        <TunnelDialog
          variant={dialogVariant}
          displayName={displayNameInput.trim()}
          onClose={() => setDialogVariant(null)}
        />
      )}
    </header>
  );
}
