import { describe, expect, it } from "vitest";
import { Room as ColyseusServerRoom } from "colyseus";
import colyseusConfig from "@colyseus/tools";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { Client, type FetchFn } from "@colyseus/sdk";
import { Connection } from "@colyseus/sdk/Connection";
import type { ITransport, ITransportEventMap } from "@colyseus/sdk/transport/ITransport";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import { attachHostProxy } from "./hostProxy.js";
import {
  completeHostConnection,
  createHostOffer,
  CONTROL_CHANNEL_LABEL,
  DATA_CHANNEL_LABEL,
} from "./rendezvous.js";

/**
 * Test di integrazione end-to-end per la Fase 6F.2 — verifica l'INTERO
 * protocollo del tunnel (fetch tunnelato + iniezione di `protocol:
 * "webrtc"` + relay della WebSocket) contro un vero server Colyseus di
 * test locale, usando DUE peer werift reali per simulare host e guest.
 *
 * NOTA IMPORTANTE SUL LATO "GUEST" QUI SOTTO: la vera implementazione
 * guest di produzione (packages/editor/src/network/webrtcTransport.ts)
 * è scritta contro i tipi DOM nativi del browser (`RTCDataChannel`
 * globale) — non è importabile/eseguibile qui, perché werift NON
 * soddisfa strutturalmente quel tipo (è una classe con campi privati,
 * non un'interfaccia) e perché questo pacchetto (Node) non ha un vero
 * browser. Le funzioni `createTunnelFetchFnForTest`/
 * `registerWebRTCTransportForTest` qui sotto sono un'implementazione
 * ANALOGA, stessa logica di webrtcTransport.ts riscritta contro i tipi
 * werift, SOLO per questo test — verifica il PROTOCOLLO e il design
 * (che è la parte rischiosa/non ovvia), non i tipi TypeScript esatti
 * del file di produzione. L'interoperabilità reale con l'implementazione
 * WebRTC nativa del browser resta da verificare nello smoke-test finale
 * su due macchine reali.
 */

interface FetchResultMessage {
  kind: "fetch-result";
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

function createTunnelFetchFnForTest(channels: {
  controlChannel: RTCDataChannel;
  dataChannel: RTCDataChannel;
}): FetchFn {
  return async (url, init) => {
    const urlString = typeof url === "string" ? url : url.toString();
    const { pathname, search } = new URL(urlString);
    const id = crypto.randomUUID();

    const headersRecord: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((value, key) => {
      headersRecord[key] = value;
    });

    const resultPromise = new Promise<FetchResultMessage>((resolve) => {
      channels.controlChannel.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { kind?: string };
        if (message.kind === "fetch-result") {
          resolve(message as unknown as FetchResultMessage);
        }
      };
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

    let bodyText = result.body;
    try {
      const parsed = JSON.parse(result.body) as Record<string, unknown>;
      parsed.protocol = "webrtc";
      bodyText = JSON.stringify(parsed);
    } catch {
      // risposta non-JSON, nessuna iniezione — stesso comportamento di webrtcTransport.ts
    }

    return new Response(bodyText, { status: result.status, headers: result.headers });
  };
}

class TestWebRTCTransport implements ITransport {
  isOpen = false;
  constructor(
    private readonly events: ITransportEventMap,
    private readonly channels: { controlChannel: RTCDataChannel; dataChannel: RTCDataChannel },
  ) {
    this.channels.dataChannel.onmessage = (event) => {
      this.events.onmessage?.(event as unknown as MessageEvent);
    };
    // werift's RTCDataChannel.onmessage è a slot singolo (a differenza di
    // DOM addEventListener, usato nella vera webrtcTransport.ts di
    // produzione) — un solo dispatcher qui per TUTTI i tipi di messaggio
    // di controllo, altrimenti un'assegnazione successiva (es. dentro
    // connect()) sovrascriverebbe silenziosamente questa.
    this.channels.controlChannel.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        kind?: string;
        code?: number;
        reason?: string;
      };
      if (message.kind === "ws-opened") {
        this.isOpen = true;
        this.events.onopen?.({} as unknown as Event);
      } else if (message.kind === "ws-closed") {
        this.isOpen = false;
        this.events.onclose?.({ code: message.code ?? 1000, reason: message.reason ?? "" } as unknown as CloseEvent);
      }
    };
  }

  connect(url: string): void {
    const { pathname, search } = new URL(url);
    this.channels.controlChannel.send(JSON.stringify({ kind: "open-ws", path: `${pathname}${search}` }));
  }

  send(data: Buffer | Uint8Array): void {
    this.channels.dataChannel.send(data as Buffer);
  }

  sendUnreliable(data: Buffer | Uint8Array): void {
    this.send(data);
  }

  close(): void {
    this.channels.controlChannel.send(JSON.stringify({ kind: "close-ws" }));
  }
}

function registerTestWebRTCTransport(channels: {
  controlChannel: RTCDataChannel;
  dataChannel: RTCDataChannel;
}): void {
  class SessionTestWebRTCTransport extends TestWebRTCTransport {
    constructor(events: ITransportEventMap) {
      super(events, channels);
    }
  }
  Connection.customTransports.webrtc = SessionTestWebRTCTransport;
}

class EchoRoom extends ColyseusServerRoom {
  override onCreate(): void {
    this.onMessage("echo", (client, message) => {
      client.send("echo", message);
    });
  }
}

describe("tunnel 6F.2 — protocollo end-to-end (fetch tunnelato + relay WS)", () => {
  it("un client @colyseus/sdk reale si unisce a una room reale interamente attraverso il tunnel", async () => {
    // Porta dedicata (2999, non 2568) per non entrare in conflitto con
    // packages/server/src/EditorRoom.test.ts quando `pnpm -r test` esegue
    // i pacchetti in parallelo — verificato empiricamente che l'overload
    // di boot() con ConfigOptions (non una Server già istanziata) rispetta
    // davvero la porta passata, a differenza dell'altro overload.
    const testServer: ColyseusTestServer = await boot(
      colyseusConfig({
        initializeGameServer: (gameServer) => {
          gameServer.define("echo_room", EchoRoom);
        },
      }),
      2999,
    );

    try {
      const hostSession = await createHostOffer();

      // "Guest" finto lato rendez-vous: un secondo peer werift, stesso
      // schema di rendezvous.test.ts.
      const guestPeerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      const guestChannels: { controlChannel?: RTCDataChannel; dataChannel?: RTCDataChannel } = {};
      guestPeerConnection.onDataChannel.subscribe((channel) => {
        if (channel.label === CONTROL_CHANNEL_LABEL) guestChannels.controlChannel = channel;
        else if (channel.label === DATA_CHANNEL_LABEL) guestChannels.dataChannel = channel;
      });

      const decodedOffer = JSON.parse(atob(hostSession.offerBlob)) as { type: "offer"; sdp: string };
      await guestPeerConnection.setRemoteDescription(decodedOffer);
      const guestAnswer = await guestPeerConnection.createAnswer();
      await guestPeerConnection.setLocalDescription(guestAnswer);
      await new Promise<void>((resolve) => {
        if (guestPeerConnection.iceGatheringState === "complete") {
          resolve();
          return;
        }
        guestPeerConnection.iceGatheringStateChange.subscribe((state) => {
          if (state === "complete") resolve();
        });
      });
      const guestFinalDescription = guestPeerConnection.localDescription;
      if (!guestFinalDescription) throw new Error("localDescription assente lato guest finto.");
      const answerBlob = btoa(
        JSON.stringify({ type: guestFinalDescription.type, sdp: guestFinalDescription.sdp }),
      );

      await completeHostConnection(hostSession, answerBlob);
      if (!guestChannels.controlChannel || !guestChannels.dataChannel) {
        throw new Error("Il guest finto non ha ricevuto entrambi i DataChannel.");
      }
      const resolvedGuestChannels = {
        controlChannel: guestChannels.controlChannel,
        dataChannel: guestChannels.dataChannel,
      };

      // Lato host: collega il proxy vero al server di test reale.
      attachHostProxy(hostSession, { colyseusHttpUrl: "http://localhost:2999" });

      // Lato guest: registra il transport e crea un Client reale di @colyseus/sdk.
      registerTestWebRTCTransport(resolvedGuestChannels);
      const client = new Client("ws://tunnel.invalid:1", {
        fetchFn: createTunnelFetchFnForTest(resolvedGuestChannels),
      });

      const room = await client.joinOrCreate("echo_room", {});
      expect(room.sessionId).toBeTruthy();

      const echoReceived = new Promise<unknown>((resolve) => {
        room.onMessage("echo", (message) => resolve(message));
      });
      room.send("echo", { hello: "dal guest attraverso il tunnel" });
      expect(await echoReceived).toEqual({ hello: "dal guest attraverso il tunnel" });

      await room.leave();
      await hostSession.peerConnection.close();
      await guestPeerConnection.close();
    } finally {
      await testServer.shutdown();
    }
  }, 20000);
});
