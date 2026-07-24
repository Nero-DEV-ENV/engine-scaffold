import type { RTCDataChannel } from "werift";
import { WebSocket } from "ws";
import type { HostRendezvousSession } from "./rendezvous.js";

/**
 * hostProxy.ts — Fase 6F.2: lato HOST, collega i due DataChannel WebRTC
 * (stabiliti da rendezvous.ts in Fase 6F.1) al vero `editor_room`
 * Colyseus in ascolto in locale (`packages/server`, avviato dall'host
 * sulla propria macchina — decisione utente, Fase 6F).
 *
 * PERCHÉ SERVE UN PROXY E NON BASTA REGISTRARE UN TRANSPORT CUSTOM
 * SUL SERVER: verificato empiricamente sul codice reale di
 * @colyseus/sdk + @colyseus/core + @colyseus/ws-transport (non
 * assumibile dalla documentazione) che il campo `response.protocol`
 * che sceglie il transport lato client viene impostato dal server SOLO
 * da `getTransport().protocol`, un singleton A LIVELLO DI PROCESSO
 * SERVER (non per-room, non per-client) — impostarlo lascerebbe
 * incompatibili client locali via WebSocket normale e client remoti
 * via tunnel sullo stesso processo. Invece qui l'host stesso, per conto
 * del guest, esegue il vero matchmake HTTP e apre la vera WebSocket
 * verso `editor_room`, poi si limita a fare da relay grezzo verso il
 * guest — nessuna modifica al server, nessun flag globale.
 *
 * PROTOCOLLO sul canale "control" (JSON, un messaggio alla volta):
 *   guest -> host: {kind:"fetch", id, method, path, headers, body?}
 *     — tunnel della richiesta HTTP di matchmake che @colyseus/sdk
 *       farebbe normalmente in chiaro (il guest non può raggiungere
 *       l'host via HTTP diretto — è esattamente il problema che il
 *       tunnel risolve). Vedi webrtcTransport.ts lato guest per il
 *       `fetchFn` che genera questi messaggi.
 *   host -> guest: {kind:"fetch-result", id, status, headers, body}
 *   guest -> host: {kind:"open-ws", path}
 *     — richiesta di aprire una vera WebSocket locale verso
 *       `editor_room` per il path/query ricevuti nella risposta di
 *       matchmake (contiene roomId+sessionId, già presenti in `path`).
 *   host -> guest: {kind:"ws-opened"} | {kind:"ws-error", message}
 *   host -> guest: {kind:"ws-closed", code, reason}
 *   guest -> host: {kind:"close-ws"} — chiusura volontaria (room.leave()).
 *
 * Canale "data": relay grezzo, un messaggio WebSocket = un messaggio
 * DataChannel, in ENTRAMBE le direzioni, nessun framing aggiuntivo
 * (RTCDataChannel preserva già i confini dei messaggi, come WebSocket —
 * non serve un protocollo a stream tipo TCP). Il protocollo Colyseus
 * vero e proprio (schema sync, Transform, presence, lock) passa qui
 * senza che questo modulo ne sappia nulla — è puro relay di byte.
 *
 * Uso: `ws` (libreria, non il global `WebSocket` di Node) — verificato
 * che Node 22 espone un global `WebSocket` stabile, ma la sua presenza
 * su Node 20/21 senza flag non è garantita; `ws` è già una dipendenza
 * transitiva del resto del monorepo (via @colyseus/ws-transport) e
 * toglie l'incertezza.
 */

interface FetchRequestMessage {
  kind: "fetch";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}
interface OpenWsMessage {
  kind: "open-ws";
  path: string;
}
interface CloseWsMessage {
  kind: "close-ws";
}
type ControlMessageFromGuest = FetchRequestMessage | OpenWsMessage | CloseWsMessage;

export interface HostProxyOptions {
  /** Base HTTP dell'editor_room locale, es. "http://localhost:2567". */
  colyseusHttpUrl: string;
}

function toUtf8(data: string | Buffer): string {
  return typeof data === "string" ? data : data.toString("utf-8");
}

/**
 * Collega i due DataChannel (già aperti, vedi `completeHostConnection`
 * in rendezvous.ts) al vero `editor_room` locale. Da chiamare una volta
 * per sessione host, subito dopo che l'handshake WebRTC è completo.
 */
export function attachHostProxy(session: HostRendezvousSession, options: HostProxyOptions): void {
  const { controlChannel, dataChannel } = session;
  let realWs: WebSocket | undefined;

  controlChannel.onmessage = (event) => {
    const message = JSON.parse(toUtf8(event.data)) as ControlMessageFromGuest;
    if (message.kind === "fetch") {
      void handleFetch(message, controlChannel, options.colyseusHttpUrl);
    } else if (message.kind === "open-ws") {
      realWs = openRealWebSocket(message.path, controlChannel, dataChannel, options.colyseusHttpUrl);
    } else if (message.kind === "close-ws") {
      realWs?.close();
    }
  };
}

async function handleFetch(
  message: FetchRequestMessage,
  controlChannel: RTCDataChannel,
  colyseusHttpUrl: string,
): Promise<void> {
  try {
    const fetchInit: RequestInit = {
      method: message.method,
      headers: message.headers,
    };
    if (message.body !== undefined) {
      fetchInit.body = message.body;
    }
    const response = await fetch(`${colyseusHttpUrl}${message.path}`, fetchInit);
    const bodyText = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    controlChannel.send(
      JSON.stringify({
        kind: "fetch-result",
        id: message.id,
        status: response.status,
        headers: responseHeaders,
        body: bodyText,
      }),
    );
  } catch (error) {
    // status 200-599 obbligatorio per il costruttore Response che il
    // guest userà per ricostruire la risposta (vedi webrtcTransport.ts) —
    // 502 Bad Gateway riflette bene "il proxy non è riuscito a raggiungere
    // il servizio locale", non un vero errore del server Colyseus.
    controlChannel.send(
      JSON.stringify({
        kind: "fetch-result",
        id: message.id,
        status: 502,
        headers: {},
        body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      }),
    );
  }
}

function openRealWebSocket(
  path: string,
  controlChannel: RTCDataChannel,
  dataChannel: RTCDataChannel,
  colyseusHttpUrl: string,
): WebSocket {
  const wsUrl = colyseusHttpUrl.replace(/^http/, "ws") + path;
  const realWs = new WebSocket(wsUrl);

  realWs.on("open", () => {
    controlChannel.send(JSON.stringify({ kind: "ws-opened" }));
  });
  realWs.on("message", (raw: Buffer) => {
    dataChannel.send(raw);
  });
  realWs.on("close", (code: number, reason: Buffer) => {
    controlChannel.send(JSON.stringify({ kind: "ws-closed", code, reason: reason.toString("utf-8") }));
  });
  realWs.on("error", (error: Error) => {
    controlChannel.send(JSON.stringify({ kind: "ws-error", message: error.message }));
  });

  dataChannel.onmessage = (event) => {
    if (realWs.readyState === WebSocket.OPEN) {
      realWs.send(event.data);
    }
  };

  return realWs;
}
