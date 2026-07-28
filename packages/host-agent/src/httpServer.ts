import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ProcessSupervisor, AgentState, LogEntry } from "./processSupervisor.js";
import type { TunnelHostSession, TunnelHostState } from "./tunnelHostSession.js";
import type { ProjectFolderSession } from "./projectFolder.js";

/**
 * httpServer.ts — Fase 6F.3.a (endpoint /server/*) + Fase 6F.3.b (endpoint
 * /tunnel/host/*) + Fase 10A (endpoint /project/*, spike project folder
 * loader). Espone ProcessSupervisor, TunnelHostSession e ora
 * ProjectFolderSession su HTTP+WS in locale — pensato per essere raggiunto
 * SOLO dall'editor sulla stessa macchina dell'host (a differenza del
 * tunnel WebRTC vero e proprio, che è un problema diverso: quello espone
 * la Room Colyseus al guest da remoto, questo espone il controllo locale
 * al browser dello stesso utente).
 *
 * /project/* non ha un canale WS dedicato (a differenza di /server/logs e
 * /tunnel/host/state) — Fase 10A non ha ancora un consumer che necessiti
 * push in tempo reale; la UI di Fase 10B interrogherà via HTTP a comando.
 *
 * DUE canali WS separati invece di uno condiviso: "/server/logs" porta
 * AgentState+LogEntry (stdout/stderr di un processo figlio spawnato),
 * "/tunnel/host/state" porta solo TunnelHostState — la sessione tunnel
 * gira IN-PROCESS (vedi tunnelHostSession.ts), non ha stdout/stderr da un
 * child process, mescolarla nel canale "logs" sarebbe fuorviante.
 *
 * Nessun controllo qui che packages/server sia "running" prima di
 * accettare POST /tunnel/host/offer (decisione utente, Fase 6F.3.b):
 * resta responsabilità della UI disabilitare il bottone finché il
 * pannello "Server locale" non è verde — se chiamato a server fermo, il
 * proxy fallirà semplicemente le fetch/WS (già gestito da hostProxy.ts,
 * status 502).
 *
 * CORS permissivo (Access-Control-Allow-Origin: "*"): l'editor Vite gira
 * su un'origine diversa (porta 5173 in dev) da questo server (porta 4100
 * di default) — nessun rischio pratico dato che questo server ascolta
 * comunque solo su localhost.
 */

type ControlMessage = { kind: "state"; state: AgentState } | { kind: "log"; entry: LogEntry };
type TunnelControlMessage = { kind: "state"; state: TunnelHostState };

export function createHostAgentServer(
  supervisor: ProcessSupervisor,
  tunnelHost: TunnelHostSession,
  projectFolder: ProjectFolderSession,
): Server {
  const server = createServer((req, res) => {
    void handleHttp(req, res, supervisor, tunnelHost, projectFolder);
  });

  const logsWss = new WebSocketServer({ noServer: true });
  logsWss.on("connection", (socket) => {
    attachLogSocket(socket, supervisor);
  });

  const tunnelStateWss = new WebSocketServer({ noServer: true });
  tunnelStateWss.on("connection", (socket) => {
    attachTunnelStateSocket(socket, tunnelHost);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url === "/server/logs") {
      logsWss.handleUpgrade(req, socket, head, (ws) => logsWss.emit("connection", ws));
    } else if (url === "/tunnel/host/state") {
      tunnelStateWss.handleUpgrade(req, socket, head, (ws) => tunnelStateWss.emit("connection", ws));
    } else {
      socket.destroy();
    }
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

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  supervisor: ProcessSupervisor,
  tunnelHost: TunnelHostSession,
  projectFolder: ProjectFolderSession,
): Promise<void> {
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

  if (req.method === "GET" && url === "/tunnel/host/status") {
    sendJson(res, 200, tunnelHost.getState());
    return;
  }
  if (req.method === "POST" && url === "/tunnel/host/offer") {
    // A differenza di /server/start (fire-and-forget, la build può durare
    // a lungo), qui si ATTENDE il completamento di startOffer(): la
    // raccolta ICE non-trickle è breve e limitata nel tempo (tipicamente
    // 1-3s con solo STUN, nessun TURN da attendere) — la risposta HTTP
    // porta quindi già l'offerBlob nello stato "awaiting-answer", senza
    // dover correlare con il canale WS per questo singolo scambio. Il
    // canale WS "/tunnel/host/state" resta comunque utile per riflettere
    // in tempo reale le transizioni successive (connecting/connected/error)
    // e per client aggiuntivi che si collegano dopo.
    //
    // 409 SOLO se lo stato non permetteva nemmeno di provare (richiesta
    // rifiutata, invariata); 202 se la richiesta è stata accettata ed
    // eseguita, ANCHE se l'esito finale è "error" — un fallimento durante
    // la generazione dell'offer non è un conflitto HTTP, è un esito
    // legittimo riflesso nello state (il client lo distingue leggendo
    // tunnelHost.getState().status).
    const initialStatus = tunnelHost.getState().status;
    if (initialStatus !== "idle" && initialStatus !== "error") {
      sendJson(res, 409, tunnelHost.getState());
      return;
    }
    await tunnelHost.startOffer();
    sendJson(res, 202, tunnelHost.getState());
    return;
  }
  if (req.method === "POST" && url === "/tunnel/host/complete") {
    let body: unknown;
    try {
      body = JSON.parse(await readRequestBody(req));
    } catch {
      sendJson(res, 400, { error: "Body JSON non valido." });
      return;
    }
    const answerBlob = (body as { answerBlob?: unknown } | null)?.answerBlob;
    if (typeof answerBlob !== "string" || answerBlob.length === 0) {
      sendJson(res, 400, { error: "Campo 'answerBlob' (stringa) mancante." });
      return;
    }
    if (tunnelHost.getState().status !== "awaiting-answer") {
      sendJson(res, 409, tunnelHost.getState());
      return;
    }
    await tunnelHost.complete(answerBlob);
    sendJson(res, 202, tunnelHost.getState());
    return;
  }
  if (req.method === "POST" && url === "/tunnel/host/close") {
    const closed = tunnelHost.close();
    sendJson(res, closed ? 202 : 409, tunnelHost.getState());
    return;
  }

  if (req.method === "GET" && url === "/project/status") {
    sendJson(res, 200, projectFolder.getState());
    return;
  }
  if (req.method === "POST" && url === "/project/open") {
    let body: unknown;
    try {
      body = JSON.parse(await readRequestBody(req));
    } catch {
      sendJson(res, 400, { error: "Body JSON non valido." });
      return;
    }
    const rootPath = (body as { path?: unknown } | null)?.path;
    if (typeof rootPath !== "string") {
      sendJson(res, 400, { error: "Campo 'path' (stringa) mancante." });
      return;
    }
    const result = projectFolder.openRoot(rootPath);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    sendJson(res, 200, projectFolder.getState());
    return;
  }
  if (req.method === "POST" && url === "/project/close") {
    const closed = projectFolder.closeRoot();
    sendJson(res, closed ? 202 : 409, projectFolder.getState());
    return;
  }
  if (req.method === "GET" && url.startsWith("/project/list")) {
    // A differenza delle altre route GET (match esatto su `url`), questa
    // porta un query param (`?path=`, relativo alla root corrente — "."
    // per la root stessa): serve estrarlo dalla query string invece di un
    // confronto diretto sull'intero `url`.
    const parsed = new URL(url, "http://localhost");
    const relativePath = parsed.searchParams.get("path") ?? ".";
    const entries = await projectFolder.listDirectory(relativePath);
    if (entries === null) {
      sendJson(res, 404, { error: "Nessuna project root aperta, o percorso non valido/non leggibile." });
      return;
    }
    sendJson(res, 200, { entries });
    return;
  }

  sendJson(res, 404, { error: "Non trovato." });
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
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

function attachTunnelStateSocket(socket: WebSocket, tunnelHost: TunnelHostSession): void {
  const send = (message: TunnelControlMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  // Stato corrente subito alla connessione — nessuno storico da rispedire
  // (a differenza dei log, non ha senso "riascoltare" transizioni passate
  // di una sessione tunnel: solo lo stato presente conta per la UI).
  send({ kind: "state", state: tunnelHost.getState() });

  const onState = (state: TunnelHostState): void => send({ kind: "state", state });
  tunnelHost.on("state", onState);

  socket.on("close", () => {
    tunnelHost.off("state", onState);
  });
}
