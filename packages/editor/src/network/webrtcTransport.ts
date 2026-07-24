import { Connection } from "@colyseus/sdk/Connection";
import type { ITransport, ITransportEventMap } from "@colyseus/sdk/transport/ITransport";
import type { FetchFn } from "@colyseus/sdk";

/**
 * webrtcTransport.ts — Fase 6F.2: lato GUEST, sostituisce sia la
 * richiesta HTTP di matchmake sia la WebSocket che @colyseus/sdk
 * userebbe normalmente, con i due DataChannel WebRTC già aperti (vedi
 * tunnelGuest.ts per come si ottengono da un offerBlob).
 *
 * `Connection`/`ITransport` non sono esportati dal punto d'ingresso
 * pubblico `@colyseus/sdk` (solo Client/Room/ecc. — verificato
 * leggendo build/index.d.ts). Verificato EMPIRICAMENTE che il subpath
 * export `@colyseus/sdk/Connection` / `@colyseus/sdk/transport/ITransport`
 * funziona comunque grazie al wildcard `"./*"` nell'"exports" del
 * package.json della libreria (risolto sia a runtime che nei tipi).
 *
 * PERCHÉ SERVE ANCHE UN fetchFn CUSTOM (non solo un ITransport): il
 * primo passo di `client.joinOrCreate()` è una richiesta HTTP di
 * matchmake fatta da `HTTP.executeRequest()` (non passa per
 * `Connection`/`ITransport`, che entra in gioco solo DOPO). Il guest
 * non può raggiungere l'host via HTTP diretto — è esattamente il
 * problema che il tunnel risolve — quindi anche questa richiesta va
 * tunnelata, sul canale "control", verso hostProxy.ts (che esegue il
 * vero fetch in locale). `@colyseus/sdk`'s `Client` accetta un
 * `options.fetchFn` pensato apposta per questo (visto in HTTP.mjs:
 * `this.fetchFn = fetchFn ?? globalThis.fetch`).
 *
 * PERCHÉ IL fetchFn INIETTA `protocol: "webrtc"` NELLA RISPOSTA: verificato
 * empiricamente che `Room.connect()` sceglie `Connection.customTransports`
 * in base a `response.protocol` — un campo che il SERVER imposterebbe
 * solo da `getTransport().protocol`, un singleton per-processo (vedi
 * hostProxy.ts per la spiegazione completa). Iniettarlo qui, lato guest,
 * solo per QUESTA risposta tunnelata, ottiene lo stesso effetto senza
 * toccare il server né influenzare altri client (locali o LAN) che si
 * connettono allo stesso processo server con un fetchFn normale.
 *
 * Uso (vedi anche packages/editor/src/network/tunnel.integration.test.ts
 * per un esempio completo end-to-end):
 *   const { channels } = await createGuestAnswer(offerBlob);
 *   const resolvedChannels = await channels;
 *   registerWebRTCTransport(resolvedChannels);
 *   const client = new Client("ws://tunnel.invalid", {
 *     fetchFn: createTunnelFetchFn(resolvedChannels),
 *   });
 *   const room = await client.joinOrCreate("editor_room", options);
 */

export interface TunnelChannels {
  controlChannel: RTCDataChannel;
  dataChannel: RTCDataChannel;
}

interface FetchResultMessage {
  kind: "fetch-result";
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Costruisce un `FetchFn` (da passare a `new Client(url, { fetchFn })`)
 * che tunnela la richiesta HTTP di matchmake sul canale "control" invece
 * di farla davvero. Vedi hostProxy.ts per la controparte lato host.
 */
export function createTunnelFetchFn(channels: TunnelChannels): FetchFn {
  return async (url, init) => {
    const urlString = typeof url === "string" ? url : url.toString();
    const { pathname, search } = new URL(urlString);
    const id = crypto.randomUUID();

    const headersRecord: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headersRecord[key] = value;
    });

    const resultPromise = new Promise<FetchResultMessage>((resolve) => {
      const handler = (event: MessageEvent): void => {
        const message = JSON.parse(String(event.data)) as { kind?: string };
        if (message.kind === "fetch-result") {
          const fetchResult = message as unknown as FetchResultMessage;
          if (fetchResult.id === id) {
            channels.controlChannel.removeEventListener("message", handler);
            resolve(fetchResult);
          }
        }
      };
      channels.controlChannel.addEventListener("message", handler);
    });

    channels.controlChannel.send(
      JSON.stringify({
        kind: "fetch",
        id,
        method: init?.method ?? "GET",
        path: `${pathname}${search}`,
        headers: headersRecord,
        body: typeof init?.body === "string" ? init.body : undefined,
      }),
    );

    const result = await resultPromise;

    // Iniezione del flag di protocollo — vedi commento in cima al file.
    let bodyText = result.body;
    try {
      const parsed = JSON.parse(result.body) as Record<string, unknown>;
      parsed.protocol = "webrtc";
      bodyText = JSON.stringify(parsed);
    } catch {
      // Risposta non-JSON (es. errore testuale) — nessuna iniezione, la
      // risposta arriva così com'è; @colyseus/sdk gestirà l'errore.
    }

    return new Response(bodyText, { status: result.status, headers: result.headers });
  };
}

/**
 * `ITransport` che usa il DataChannel "data" già aperto al posto di una
 * vera WebSocket, e il canale "control" per far aprire all'host la vera
 * WebSocket locale verso `editor_room` (vedi hostProxy.ts).
 */
class WebRTCTransport implements ITransport {
  isOpen = false;
  private readonly events: ITransportEventMap;
  private readonly channels: TunnelChannels;

  constructor(events: ITransportEventMap, channels: TunnelChannels) {
    this.events = events;
    this.channels = channels;
    // ArrayBuffer invece del default "blob" — il protocollo Colyseus
    // (msgpack via @colyseus/schema) si aspetta ArrayBuffer/Buffer, non
    // un Blob (stesso motivo per cui una vera WebSocketTransport nel
    // browser imposta sempre `binaryType = "arraybuffer"`).
    this.channels.dataChannel.binaryType = "arraybuffer";
    this.channels.dataChannel.addEventListener("message", (event: MessageEvent) => {
      this.events.onmessage?.(event);
    });
    this.channels.controlChannel.addEventListener("message", (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as {
        kind?: string;
        code?: number;
        reason?: string;
      };
      if (message.kind === "ws-closed") {
        this.isOpen = false;
        this.events.onclose?.({ code: message.code ?? 1000, reason: message.reason ?? "" });
      }
    });
  }

  connect(url: string): void {
    const { pathname, search } = new URL(url);
    const handler = (event: MessageEvent): void => {
      const message = JSON.parse(String(event.data)) as { kind?: string; message?: string };
      if (message.kind === "ws-opened") {
        this.channels.controlChannel.removeEventListener("message", handler);
        this.isOpen = true;
        this.events.onopen?.({});
      } else if (message.kind === "ws-error") {
        this.channels.controlChannel.removeEventListener("message", handler);
        this.events.onerror?.({ message: message.message ?? "Errore WebSocket lato host" });
      }
    };
    this.channels.controlChannel.addEventListener("message", handler);
    this.channels.controlChannel.send(JSON.stringify({ kind: "open-ws", path: `${pathname}${search}` }));
  }

  send(data: Buffer | Uint8Array): void {
    // DOM tipizza RTCDataChannel.send() su ArrayBufferView<ArrayBuffer>
    // (non ArrayBufferLike, che include anche SharedArrayBuffer) — il
    // nostro Buffer/Uint8Array è sempre backed da un vero ArrayBuffer in
    // pratica (dati appena ricevuti/codificati, mai SharedArrayBuffer in
    // questo progetto), il cast qui è sicuro a runtime.
    this.channels.dataChannel.send(data as Uint8Array<ArrayBuffer>);
  }

  sendUnreliable(data: Buffer | Uint8Array): void {
    // Un singolo DataChannel ordinato+affidabile (vedi rendezvous.ts) non
    // distingue un percorso "non affidabile" — alias a send(), stessa
    // semantica della WebSocketTransport di default (anche lei non ha un
    // vero canale non affidabile).
    this.send(data);
  }

  close(): void {
    this.channels.controlChannel.send(JSON.stringify({ kind: "close-ws" }));
  }
}

/**
 * Registra una classe `WebRTCTransport` legata a QUESTI due DataChannel
 * in `Connection.customTransports.webrtc` (via la patch
 * patches/@colyseus__sdk@0.17.43.patch). Da chiamare una volta per
 * sessione, dopo aver atteso `channels` da `createGuestAnswer()` e
 * PRIMA di `client.joinOrCreate(...)`.
 */
export function registerWebRTCTransport(channels: TunnelChannels): void {
  class SessionWebRTCTransport extends WebRTCTransport {
    constructor(events: ITransportEventMap) {
      super(events, channels);
    }
  }
  Connection.customTransports.webrtc = SessionWebRTCTransport;
}
