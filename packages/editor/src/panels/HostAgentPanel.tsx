import { useEffect, useRef, useState } from "react";
import {
  agentStateStore,
  agentConnectionStore,
  agentLogsStore,
  ensureAgentMonitoring,
  startAgentServer,
  stopAgentServer,
  type AgentState,
  type AgentConnectionState,
} from "../network/hostAgentClient.js";

/**
 * HostAgentPanel — Fase 6F.3.a: pannello dedicato in basso nell'editor per
 * avviare/fermare packages/server tramite @engine/host-agent (processo
 * separato, avviato una tantum dall'utente via start-hidden.ps1 — vedi
 * commento in cima a network/hostAgentClient.ts). Bottoni Start/Stop +
 * riquadro log scrollabile ("terminale interno"): l'utente non deve mai
 * aprire/tenere aperto un terminale esterno che potrebbe chiudere per
 * errore.
 *
 * Indipendente dal bottone Connect/Disconnect di Topbar.tsx: quello serve
 * a unirsi alla Room Colyseus (client), questo al ciclo di vita del
 * PROPRIO processo server locale.
 */
export function HostAgentPanel(): JSX.Element {
  const connection = agentConnectionStore.useValue();
  const state = agentStateStore.useValue();
  const logs = agentLogsStore.useValue();
  const [collapsed, setCollapsed] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    ensureAgentMonitoring();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const agentReachable = connection === "connected";
  const canStart = agentReachable && (state.status === "idle" || state.status === "error");
  const canStop =
    agentReachable && (state.status === "building" || state.status === "starting" || state.status === "running");

  return (
    <section className="host-agent-panel" aria-label="Controllo server locale">
      <div className="host-agent-header">
        <button
          type="button"
          className="host-agent-collapse-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Espandi pannello server locale" : "Comprimi pannello server locale"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="host-agent-title">Server locale</span>
        <span className={`host-agent-status host-agent-status-${statusClass(connection, state)}`}>
          {statusLabel(connection, state)}
        </span>
        <div className="host-agent-actions">
          <button type="button" className="topbar-button" disabled={!canStart} onClick={() => void startAgentServer()}>
            Start
          </button>
          <button type="button" className="topbar-button" disabled={!canStop} onClick={() => void stopAgentServer()}>
            Stop
          </button>
        </div>
      </div>
      {!collapsed && (
        <pre className="host-agent-log" aria-live="polite" ref={logRef}>
          {logs.length === 0
            ? "Nessuna riga di log ancora."
            : logs.map((entry) => `[${entry.stream}] ${entry.line}`).join("\n")}
        </pre>
      )}
    </section>
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
