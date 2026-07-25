import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ProcessSupervisor, AgentState, LogEntry } from "./processSupervisor.js";

/**
 * httpServer.ts — Fase 6F.3.a. Espone il ProcessSupervisor su HTTP+WS in
 * locale — pensato per essere raggiunto SOLO dall'editor sulla stessa
 * macchina dell'host (a differenza del tunnel WebRTC di Fase 6F, che è un
 * problema diverso: quello espone la Room Colyseus al guest da remoto,
 * questo espone il controllo del processo server al browser dello stesso
 * utente in locale).
 *
 * CORS permissivo (Access-Control-Allow-Origin: "*"): l'editor Vite gira
 * su un'origine diversa (porta 5173 in dev) da questo server (porta 4100
 * di default) — nessun rischio pratico dato che questo server ascolta
 * comunque solo su localhost.
 */

type ControlMessage = { kind: "state"; state: AgentState } | { kind: "log"; entry: LogEntry };

export function createHostAgentServer(supervisor: ProcessSupervisor): Server {
  const server = createServer((req, res) => {
    handleHttp(req, res, supervisor);
  });

  const wss = new WebSocketServer({ server, path: "/server/logs" });
  wss.on("connection", (socket) => {
    attachLogSocket(socket, supervisor);
  });

  return server;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

function handleHttp(req: IncomingMessage, res: ServerResponse, supervisor: ProcessSupervisor): void {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = req.url ?? "";

  if (req.method === "GET" && url === "/server/status") {
    sendJson(res, 200, supervisor.getState());
    return;
  }
  if (req.method === "POST" && url === "/server/start") {
    const started = supervisor.start();
    sendJson(res, started ? 202 : 409, supervisor.getState());
    return;
  }
  if (req.method === "POST" && url === "/server/stop") {
    const stopped = supervisor.stop();
    sendJson(res, stopped ? 202 : 409, supervisor.getState());
    return;
  }

  sendJson(res, 404, { error: "Non trovato." });
}

function attachLogSocket(socket: WebSocket, supervisor: ProcessSupervisor): void {
  const send = (message: ControlMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  // Storico recente + stato corrente subito alla connessione: un client
  // che si collega DOPO l'avvio deve comunque vedere la coda dei log.
  for (const entry of supervisor.getRecentLogs()) send({ kind: "log", entry });
  send({ kind: "state", state: supervisor.getState() });

  const onLog = (entry: LogEntry): void => send({ kind: "log", entry });
  const onState = (state: AgentState): void => send({ kind: "state", state });
  supervisor.on("log", onLog);
  supervisor.on("state", onState);

  socket.on("close", () => {
    supervisor.off("log", onLog);
    supervisor.off("state", onState);
  });
}
