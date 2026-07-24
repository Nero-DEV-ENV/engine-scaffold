import { describe, expect, it } from "vitest";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import { completeHostConnection, createHostOffer } from "./rendezvous.js";

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
});
