import { describe, expect, it, vi } from "vitest";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import { completeHostConnection, createHostOffer, raceConnectionEstablishment } from "./rendezvous.js";

/**
 * Finto "ConnectionStateSource" per testare `raceConnectionEstablishment`
 * in isolamento, senza dover forzare un vero fallimento ICE (non
 * riproducibile in modo affidabile in sandbox — nessuna vera
 * irraggiungibilità di rete controllabile qui). `emit` simula werift che
 * notifica un cambio di connectionState.
 */
function createFakeConnectionStateSource(): {
  source: Parameters<typeof raceConnectionEstablishment>[0];
  emit: (state: "disconnected" | "closed" | "new" | "connected" | "connecting" | "failed") => void;
} {
  const listeners: Array<(state: "disconnected" | "closed" | "new" | "connected" | "connecting" | "failed") => void> =
    [];
  return {
    source: {
      connectionStateChange: {
        subscribe: (execute) => {
          listeners.push(execute);
          return { unSubscribe: () => listeners.splice(listeners.indexOf(execute), 1) };
        },
      },
    },
    emit: (state) => {
      for (const listener of [...listeners]) listener(state);
    },
  };
}

describe("raceConnectionEstablishment", () => {
  it("risolve normalmente se establishPromise si risolve prima del timeout e senza fallimento ICE", async () => {
    const { source } = createFakeConnectionStateSource();
    await expect(raceConnectionEstablishment(source, Promise.resolve(), 1000)).resolves.toBeUndefined();
  });

  it("rigetta con messaggio chiaro se connectionStateChange riporta 'failed', PRIMA del timeout", async () => {
    vi.useFakeTimers();
    try {
      const { source, emit } = createFakeConnectionStateSource();
      const neverResolves = new Promise<void>(() => {});
      const result = raceConnectionEstablishment(source, neverResolves, 15_000);
      emit("connecting");
      emit("failed");
      await expect(result).rejects.toThrow(/ICE failed/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rigetta con messaggio chiaro allo scadere del timeout se nessun segnale di fallimento arriva", async () => {
    vi.useFakeTimers();
    try {
      const { source } = createFakeConnectionStateSource();
      const neverResolves = new Promise<void>(() => {});
      const result = raceConnectionEstablishment(source, neverResolves, 5000);
      vi.advanceTimersByTime(5000);
      await expect(result).rejects.toThrow(/non stabilita entro 5000ms/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propaga il rigetto di establishPromise se questa fallisce per un motivo diverso dal timeout/ICE", async () => {
    const { source } = createFakeConnectionStateSource();
    await expect(
      raceConnectionEstablishment(source, Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
  });
});

/**
 * Questo test verifica SOLO la meccanica dell'API lato host (werift) e il
 * formato del blob, con un secondo peer werift che finge il guest al
 * posto di un vero browser — NON verifica il vero attraversamento NAT via
 * STUN (in sandbox non c'è raggiungibilità UDP reale verso uno STUN
 * pubblico, la raccolta ICE si completa comunque con soli candidati
 * "host", il che è sufficiente per validare l'API), né l'interoperabilità
 * reale con l'implementazione WebRTC nativa di un browser — quello
 * richiede lo smoke-test manuale su due macchine/reti reali (vedi
 * packages/editor/src/network/tunnelGuest.ts, non testabile qui).
 */
describe("rendezvous — lato host", () => {
  it("crea un offerBlob decodificabile e apre ENTRAMBI i DataChannel con un peer werift che finge il guest", async () => {
    const hostSession = await createHostOffer();
    expect(hostSession.offerBlob.length).toBeGreaterThan(0);

    const decodedOffer = JSON.parse(atob(hostSession.offerBlob)) as { type: string; sdp: string };
    expect(decodedOffer.type).toBe("offer");
    expect(decodedOffer.sdp).toContain("a=candidate");

    // Guest finto: un secondo peer werift che risponde come farebbe il
    // browser reale (stesso protocollo standard, solo API diversa) e
    // raccoglie i due DataChannel per label, come fa davvero tunnelGuest.ts.
    const guestPeerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const guestChannels: Record<string, RTCDataChannel> = {};
    guestPeerConnection.onDataChannel.subscribe((channel) => {
      guestChannels[channel.label] = channel;
    });

    await guestPeerConnection.setRemoteDescription({ type: "offer", sdp: decodedOffer.sdp });
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

    expect(hostSession.controlChannel.readyState).toBe("open");
    expect(hostSession.dataChannel.readyState).toBe("open");
    expect(guestChannels["colyseus-tunnel-control"]?.readyState).toBe("open");
    expect(guestChannels["colyseus-tunnel-data"]?.readyState).toBe("open");

    // Scambio effettivo su ENTRAMBI i canali, non solo stato "open".
    const guestControlReceived = new Promise<string>((resolve) => {
      guestChannels["colyseus-tunnel-control"]!.onmessage = (e) => resolve(String(e.data));
    });
    hostSession.controlChannel.send("ping-control");
    expect(await guestControlReceived).toBe("ping-control");

    const guestDataReceived = new Promise<string>((resolve) => {
      guestChannels["colyseus-tunnel-data"]!.onmessage = (e) => resolve(String(e.data));
    });
    hostSession.dataChannel.send("ping-data");
    expect(await guestDataReceived).toBe("ping-data");

    await hostSession.peerConnection.close();
    await guestPeerConnection.close();
  }, 15000);

  it("completeHostConnection rigetta se timeoutMs scade prima che i DataChannel aprano (parametro cablato correttamente, non solo la logica isolata sopra)", async () => {
    // Non forziamo un vero fallimento NAT (non riproducibile in modo
    // affidabile in sandbox): usiamo un timeoutMs artificialmente
    // piccolo (1ms) su un handshake werift reale — la connettività reale
    // richiede comunque più di 1ms, quindi il timeout vince sempre.
    // Verifica SOLO che il parametro sia cablato end-to-end; il vero
    // fallimento NAT resta nello smoke-test manuale finale di Fase 6F.
    const hostSession = await createHostOffer();
    const decodedOffer = JSON.parse(atob(hostSession.offerBlob)) as { type: string; sdp: string };

    const guestPeerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    await guestPeerConnection.setRemoteDescription({ type: "offer", sdp: decodedOffer.sdp });
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

    await expect(completeHostConnection(hostSession, answerBlob, 1)).rejects.toThrow(/non stabilita entro 1ms/);

    await hostSession.peerConnection.close();
    await guestPeerConnection.close();
  }, 15000);
});
