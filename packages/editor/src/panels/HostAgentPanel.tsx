import { useEffect } from "react";
import {
  agentStateStore,
  agentConnectionStore,
  ensureAgentMonitoring,
  startAgentServer,
  stopAgentServer,
  restartAgentServer,
  type AgentState,
  type AgentConnectionState,
} from "../network/hostAgentClient.js";
import { RestartIcon } from "../icons.js";

/**
 * HostAgentPanel — Fase 6F.3.a: avvia/ferma packages/server tramite
 * @engine/host-agent (processo separato, avviato una tantum dall'utente
 * via start-hidden.ps1 — vedi commento in cima a network/hostAgentClient.ts).
 *
 * Fase 9 — su decisione utente, il pannello con collapse-toggle + log
 * scrollabile ("terminale interno", introdotto in 6F.3.a) è stato
 * sostituito da una fascia sottile in fondo, stile status bar di Unity
 * (vedi screenshot di riferimento): solo pallino di stato online/offline +
 * bottoni Start/Stop "in rilievo". Il log NON è più raggiungibile da
 * questa UI in questa fase (nessun modo di espanderlo) — resta letto da
 * `agentLogsStore` (hostAgentClient.ts) per un'eventuale reintroduzione
 * futura, solo non più consumato qui. Il messaggio di stato descrittivo
 * (`statusLabel`) resta comunque disponibile per screen reader/tooltip
 * (`title` + testo `.sr-only`), non solo come colore del pallino.
 *
 * Indipendente dal bottone Connect/Disconnect di Topbar.tsx: quello serve
 * a unirsi alla Room Colyseus (client), questo al ciclo di vita del
 * PROPRIO processo server locale.
 */
export function HostAgentPanel(): JSX.Element {
  const connection = agentConnectionStore.useValue();
  const state = agentStateStore.useValue();

  useEffect(() => {
    ensureAgentMonitoring();
  }, []);

  const agentReachable = connection === "connected";
  const canStart = agentReachable && (state.status === "idle" || state.status === "error");
  const canStop =
    agentReachable && (state.status === "building" || state.status === "starting" || state.status === "running");
  // Fase 11B.1 — stesso insieme di stati "non in transizione" di canStart/
  // canStop sopra, ma senza restringere a idle/error/running specifici: un
  // riavvio è sensato sia da fermo (equivale a uno start) sia da in
  // esecuzione (stop atteso + start) — solo le transizioni intermedie
  // (building/starting/stopping) lo disabilitano, vedi guardia in
  // restartAgentServer (hostAgentClient.ts).
  const canRestart =
    agentReachable && state.status !== "building" && state.status !== "starting" && state.status !== "stopping";
  const label = statusLabel(connection, state);

  return (
    <footer className="host-status-bar" aria-label="Controllo server locale">
      <span
        className={`host-status-dot host-status-dot-${statusClass(connection, state)}`}
        title={label}
        role="img"
        aria-label={label}
      />
      <span className="sr-only">{label}</span>
      <div className="host-status-actions">
        <button
          type="button"
          className="host-status-button"
          disabled={!canStart}
          onClick={() => void startAgentServer()}
        >
          Start
        </button>
        <button
          type="button"
          className="host-status-icon-button"
          disabled={!canRestart}
          onClick={() => void restartAgentServer()}
          aria-label="Riavvia server"
          title="Riavvia (ricompila e riavvia packages/server)"
        >
          <RestartIcon />
        </button>
        <button type="button" className="host-status-button" disabled={!canStop} onClick={() => void stopAgentServer()}>
          Stop
        </button>
      </div>
    </footer>
  );
}

function statusClass(connection: AgentConnectionState, state: AgentState): string {
  if (connection !== "connected") return "unreachable";
  return state.status;
}

function statusLabel(connection: AgentConnectionState, state: AgentState): string {
  if (connection === "connecting") return "Connessione all'agente…";
  if (connection === "disconnected") return "Agente non raggiunto — avvia start-hidden.ps1";
  switch (state.status) {
    case "idle":
      return "Inattivo";
    case "building":
      return "Build in corso…";
    case "starting":
      return "Avvio in corso…";
    case "running":
      return `In esecuzione (pid ${state.pid})`;
    case "stopping":
      return "Arresto in corso…";
    case "error":
      return `Errore: ${state.message}`;
  }
}
