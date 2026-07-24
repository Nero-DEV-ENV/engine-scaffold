/**
 * tunnelGuest.ts — Fase 6F.1: lato GUEST del rendez-vous a codice di
 * invito. Vedi packages/tunnel/src/rendezvous.ts per il lato host e la
 * spiegazione completa del flusso a due blob (offerBlob dall'host →
 * answerBlob da qui a ritorno) e dei due DataChannel (control/data,
 * aggiunti in Fase 6F.2 — vedi anche webrtcTransport.ts, che li usa).
 *
 * Usa le API WebRTC native del browser (`RTCPeerConnection` globale,
 * dal lib "DOM" del tsconfig) — NON `werift`, che è una libreria
 * Node-only e non è nemmeno una dependency di questo pacchetto: il
 * browser ha già un'implementazione WebRTC nativa, non serve una
 * libreria userland qui.
 *
 * NOTA DI DUPLICAZIONE: `encodeBlob`/`decodeBlob` e le due label dei
 * DataChannel sono identiche a quelle in
 * packages/tunnel/src/rendezvous.ts — duplicate di proposito invece di
 * condivise via @engine/core (che è il runtime motore/Unity-style, non
 * una libreria di rete). Vedi commento gemello là per i dettagli. Le
 * due label DEVONO restare identiche fra i due file.
 */

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const CONTROL_CHANNEL_LABEL = "colyseus-tunnel-control";
const DATA_CHANNEL_LABEL = "colyseus-tunnel-data";

interface SessionDescriptionBlob {
  type: "offer" | "answer";
  sdp: string;
}

function encodeBlob(desc: SessionDescriptionBlob): string {
  return btoa(JSON.stringify(desc));
}

function decodeBlob(blob: string): SessionDescriptionBlob {
  return JSON.parse(atob(blob)) as SessionDescriptionBlob;
}

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === "complete") {
      resolve();
      return;
    }
    peerConnection.addEventListener("icegatheringstatechange", () => {
      if (peerConnection.iceGatheringState === "complete") resolve();
    });
  });
}

export interface GuestRendezvousResult {
  peerConnection: RTCPeerConnection;
  /** Risolve quando ENTRAMBI i DataChannel creati dall'host sono arrivati (aperti li apre poi webrtcTransport.ts/hostProxy.ts). */
  channels: Promise<{ controlChannel: RTCDataChannel; dataChannel: RTCDataChannel }>;
  /** Blob (base64) da ridare all'host per chiudere l'handshake. */
  answerBlob: string;
}

/**
 * Consuma l'offerBlob incollato dall'utente (generato dall'host), genera
 * l'answer, attende la raccolta ICE completa (non-trickle, stesso motivo
 * di rendezvous.ts) e restituisce il blob di risposta da ridare
 * all'host, più una Promise per i due DataChannel che l'host ha creato
 * (ricevuti qui via l'evento `datachannel`, distinti per `label` — non
 * c'è garanzia sull'ordine di arrivo dei due).
 */
export async function createGuestAnswer(offerBlob: string): Promise<GuestRendezvousResult> {
  const offer = decodeBlob(offerBlob);
  if (offer.type !== "offer") {
    throw new Error(`Blob inatteso: tipo "${offer.type}", attesa "offer".`);
  }

  const peerConnection = new RTCPeerConnection({ iceServers: STUN_SERVERS });

  const channels = new Promise<{ controlChannel: RTCDataChannel; dataChannel: RTCDataChannel }>((resolve) => {
    let controlChannel: RTCDataChannel | undefined;
    let dataChannel: RTCDataChannel | undefined;
    peerConnection.addEventListener("datachannel", (event: RTCDataChannelEvent) => {
      if (event.channel.label === CONTROL_CHANNEL_LABEL) {
        controlChannel = event.channel;
      } else if (event.channel.label === DATA_CHANNEL_LABEL) {
        dataChannel = event.channel;
      }
      if (controlChannel && dataChannel) {
        resolve({ controlChannel, dataChannel });
      }
    });
  });

  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await waitForIceGatheringComplete(peerConnection);

  const finalDescription = peerConnection.localDescription;
  if (!finalDescription) {
    throw new Error("localDescription assente dopo setLocalDescription — non dovrebbe accadere.");
  }

  return {
    peerConnection,
    channels,
    // `finalDescription.type` è tipato `RTCSdpType` dal lib DOM (include
    // anche "pranswer"/"rollback"), più ampio del nostro blob — qui sappiamo
    // per costruzione che è sempre "answer" (appena creata da createAnswer()).
    answerBlob: encodeBlob({ type: "answer", sdp: finalDescription.sdp }),
  };
}
