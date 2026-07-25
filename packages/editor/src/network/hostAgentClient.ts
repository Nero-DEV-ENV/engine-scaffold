import { createExternalStore } from "../store/editorStore.js";

/**
 * hostAgentClient.ts — Fase 6F.3.a: client HTTP+WebSocket per
 * @engine/host-agent (processo separato, avviato dall'utente una tantum
 * tramite packages/host-agent/start-hidden.ps1). Gestisce SOLO il ciclo
 * di vita del PROPRIO packages/server locale — niente a che fare con la
 * Room Colyseus (collabClient.ts, bottone Connect/Disconnect in Topbar)
 * né con il tunnel WebRTC (Fase 6F.3.b, ancora da fare).
 *
 * `AgentState`/`LogEntry` duplicano la shape dei tipi omonimi in
 * packages/host-agent/src/processSupervisor.ts invece di condividerli via
 * @engine/core — stesso pattern già usato per tunnelGuest.ts/
 * rendezvous.ts: è un confine di rete (HTTP/WS locale fra due processi
 * separati), @engine/core è il runtime del motore e non ha nulla a che
 * fare con il protocollo di controllo di questo agente.
 */

export type AgentState =
  | { status: "idle" }
  | { status: "building" }
  | { status: "starting" }
  | { status: "running"; pid: number }
  | { status: "stopping" }
  | { status: "error"; message: string };

export interface LogEntry {
  stream: "stdout" | "stderr" | "agent";
  line: string;
  at: number;
}

export type AgentConnectionState = "connecting" | "connected" | "disconnected";

type IncomingMessage = { kind: "state"; state: AgentState } | { kind: "log"; entry: LogEntry };

const DEFAULT_HTTP_URL = "http://localhost:4100";
const RECONNECT_DELAY_MS = 3000;
const CLIENT_LOG_CAP = 500;

function httpBaseUrl(): string {
  return import.meta.env.VITE_HOST_AGENT_HTTP_URL ?? DEFAULT_HTTP_URL;
}

function logsWsUrl(): string {
  return `${httpBaseUrl().replace(/^http/, "ws")}/server/logs`;
}

export const agentStateStore = createExternalStore<AgentState>({ status: "idle" });
export const agentConnectionStore = createExternalStore<AgentConnectionState>("connecting");
export const agentLogsStore = createExternalStore<readonly LogEntry[]>([]);

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let monitoringStarted = false;

function appendLog(entry: LogEntry): void {
  const next = [...agentLogsStore.get(), entry];
  if (next.length > CLIENT_LOG_CAP) next.splice(0, next.length - CLIENT_LOG_CAP);
  agentLogsStore.set(next);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, RECONNECT_DELAY_MS);
}

function openSocket(): void {
  agentConnectionStore.set("connecting");
  const ws = new WebSocket(logsWsUrl());
  socket = ws;

  ws.onopen = () => {
    agentConnectionStore.set("connected");
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as IncomingMessage;
    if (message.kind === "state") {
      agentStateStore.set(message.state);
    } else {
      appendLog(message.entry);
    }
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    agentConnectionStore.set("disconnected");
    scheduleReconnect();
  };
}

/**
 * Avvia il monitoraggio (connessione WebSocket a stato/log dell'agente).
 * Idempotente — sicuro da chiamare da più effect React montati più volte
 * (React StrictMode in dev monta/smonta due volte). A differenza della
 * Room Colyseus non esiste un `disconnect` simmetrico: restare collegati
 * all'agente locale per tutta la vita dell'editor è il comportamento
 * voluto (è un pannello di monitoraggio persistente, non una sessione).
 * Riconnette automaticamente ogni 3s se l'agente non è raggiungibile
 * (es. l'utente non ha ancora lanciato start-hidden.ps1).
 */
export function ensureAgentMonitoring(): void {
  if (monitoringStarted) return;
  monitoringStarted = true;
  openSocket();
}

async function postCommand(path: "/server/start" | "/server/stop"): Promise<void> {
  try {
    await fetch(`${httpBaseUrl()}${path}`, { method: "POST" });
  } catch {
    // Agente non raggiungibile via HTTP: agentConnectionStore lo riflette
    // già tramite il WebSocket ("disconnected") — nessuna azione ulteriore
    // da fare qui, il pannello mostra già lo stato corretto.
  }
}

export function startAgentServer(): Promise<void> {
  return postCommand("/server/start");
}

export function stopAgentServer(): Promise<void> {
  return postCommand("/server/stop");
}
