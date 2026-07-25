import { createExternalStore } from "../store/editorStore.js";

/**
 * tunnelHostClient.ts — Fase 6F.3.d: client HTTP+WebSocket per l'API
 * `/tunnel/host/*` di @engine/host-agent (già esposta e verificata in
 * Fase 6F.3.b — vedi packages/host-agent/src/httpServer.ts e
 * tunnelHostSession.ts). STESSO pattern di network/hostAgentClient.ts
 * (store React esterni + WebSocket con riconnessione automatica ogni 3s)
 * ma per un'API/canale WS diversi — non estende hostAgentClient.ts
 * perché quello gestisce il ciclo di vita di packages/server (`/server/*`,
 * WS `/server/logs` con log+stato), questo la sessione tunnel WebRTC
 * (`/tunnel/host/*`, WS `/tunnel/host/state` con SOLO stato, nessuno
 * storico — vedi httpServer.ts: la sessione gira in-process, non ha
 * stdout/stderr da un child process).
 *
 * `TunnelHostState` duplica la shape del tipo omonimo in
 * packages/host-agent/src/tunnelHostSession.ts invece di condividerla via
 * @engine/core — stesso motivo/pattern già usato per `AgentState` in
 * hostAgentClient.ts: è un confine di rete fra due processi separati,
 * @engine/core è il runtime del motore e non c'entra col protocollo di
 * controllo di questo agente.
 *
 * Le funzioni `startTunnelHostOffer`/`completeTunnelHost`/`closeTunnelHost`
 * ignorano deliberatamente il corpo della risposta HTTP (stesso pattern di
 * `postCommand` in hostAgentClient.ts): `tunnelHost.setState(...)` lato
 * server emette l'evento 'state' (che il WS inoltra) PRIMA di scrivere la
 * risposta HTTP (vedi httpServer.ts, `await tunnelHost.startOffer()` poi
 * `sendJson`), quindi la UI vede sempre la transizione via
 * `tunnelHostStateStore` non più tardi della risposta HTTP stessa — non
 * serve leggere il body per restare aggiornati. Se l'agente non è
 * raggiungibile via HTTP, `tunnelHostConnectionStore` lo riflette già
 * tramite il WebSocket.
 */

export type TunnelHostState =
  | { status: "idle" }
  | { status: "generating-offer" }
  | { status: "awaiting-answer"; offerBlob: string }
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "error"; message: string };

export type TunnelHostConnectionState = "connecting" | "connected" | "disconnected";

type IncomingMessage = { kind: "state"; state: TunnelHostState };

const DEFAULT_HTTP_URL = "http://localhost:4100";
const RECONNECT_DELAY_MS = 3000;

function httpBaseUrl(): string {
  return import.meta.env.VITE_HOST_AGENT_HTTP_URL ?? DEFAULT_HTTP_URL;
}

function tunnelStateWsUrl(): string {
  return `${httpBaseUrl().replace(/^http/, "ws")}/tunnel/host/state`;
}

export const tunnelHostStateStore = createExternalStore<TunnelHostState>({ status: "idle" });
export const tunnelHostConnectionStore = createExternalStore<TunnelHostConnectionState>("connecting");

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let monitoringStarted = false;

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, RECONNECT_DELAY_MS);
}

function openSocket(): void {
  tunnelHostConnectionStore.set("connecting");
  const ws = new WebSocket(tunnelStateWsUrl());
  socket = ws;

  ws.onopen = () => {
    tunnelHostConnectionStore.set("connected");
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as IncomingMessage;
    tunnelHostStateStore.set(message.state);
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    tunnelHostConnectionStore.set("disconnected");
    scheduleReconnect();
  };
}

/**
 * Avvia il monitoraggio (connessione WebSocket a `/tunnel/host/state`).
 * Idempotente — sicuro da chiamare da più effect React montati più volte
 * (React StrictMode in dev). Stesso ciclo di vita di
 * `ensureAgentMonitoring` in hostAgentClient.ts: nessun `disconnect`
 * simmetrico, resta collegato per tutta la vita dell'editor.
 */
export function ensureTunnelHostMonitoring(): void {
  if (monitoringStarted) return;
  monitoringStarted = true;
  openSocket();
}

async function postJson(path: string, body?: unknown): Promise<void> {
  try {
    const init: RequestInit = { method: "POST" };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    await fetch(`${httpBaseUrl()}${path}`, init);
  } catch {
    // Agente non raggiungibile via HTTP: tunnelHostConnectionStore lo
    // riflette già tramite il WebSocket ("disconnected") — vedi commento
    // in cima al file, stesso pattern di hostAgentClient.ts.
  }
}

/**
 * Avvia una nuova sessione tunnel (genera l'offerBlob). BLOCCANTE lato
 * server (attende la raccolta ICE completa — vedi DECISIONE 14 nel
 * documento di Fase 6F.3.b), ma questa funzione non attende il body:
 * `tunnelHostStateStore` riceve già `{status:"awaiting-answer", offerBlob}`
 * (o `{status:"error", ...}`) via WS non più tardi del completamento
 * della richiesta HTTP. 409 lato server se lo stato non era idle/error
 * (la UI deve comunque disabilitare il bottone "Ospita" fuori da questi
 * stati, quindi non dovrebbe accadere in condizioni normali).
 */
export function startTunnelHostOffer(): Promise<void> {
  return postJson("/tunnel/host/offer");
}

/**
 * Completa l'handshake con l'answerBlob incollato dall'utente (ricevuto
 * dal guest). BLOCCANTE lato server, stesso discorso di
 * `startTunnelHostOffer` sopra per l'attesa del body. 409 lato server se
 * lo stato non era awaiting-answer, 400 se `answerBlob` manca/non è una
 * stringa (la UI deve comunque impedire l'invio di un campo vuoto).
 */
export function completeTunnelHost(answerBlob: string): Promise<void> {
  return postJson("/tunnel/host/complete", { answerBlob });
}

/** Chiude la sessione tunnel corrente e torna a idle. 409 lato server se già idle. */
export function closeTunnelHost(): Promise<void> {
  return postJson("/tunnel/host/close");
}
