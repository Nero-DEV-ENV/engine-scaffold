import { RTCPeerConnection, type RTCDataChannel } from "werift";

/**
 * rendezvous.ts — Fase 6F.1: stabilimento del canale WebRTC lato HOST
 * tramite un codice di invito copiato/incollato manualmente (decisione
 * utente: nessun server di rendez-vous di terze parti, niente Hetzner
 * per questo scambio).
 *
 * Il flusso richiede DUE blob, uno per verso (WebRTC richiede offer+
 * answer in entrambe le direzioni, non è possibile stabilire la
 * connessione con un solo scambio):
 *   1. Host chiama `createHostOffer()` → ottiene un `offerBlob` da
 *      copiare e mandare al guest (fuori banda, es. chat/messaggio).
 *   2. Guest (vedi packages/editor/src/network/tunnelGuest.ts per il
 *      lato guest — stesso schema, browser native RTCPeerConnection
 *      invece di werift, che è Node-only) genera un `answerBlob` da
 *      ridare all'host.
 *   3. Host chiama `completeHostConnection(session, answerBlob)` per
 *      chiudere l'handshake; la Promise risolve quando ENTRAMBI i
 *      DataChannel sono aperti e pronti all'uso.
 *
 * DUE DataChannel (aggiunto in Fase 6F.2, negoziati insieme nella stessa
 * offer — nessun giro in più): "control" per il protocollo di tunneling
 * del matchmake HTTP + apertura/chiusura della WebSocket reale (vedi
 * hostProxy.ts), "data" per il relay grezzo dei byte del protocollo
 * Colyseus (un messaggio WebSocket = un messaggio DataChannel, RTCData-
 * Channel preserva già i confini dei messaggi come WebSocket — nessun
 * bisogno di framing aggiuntivo tipo stream TCP).
 *
 * ICE non-trickle (decisione utente, implicita nella scelta del codice
 * manuale): si attende `iceGatheringState === "complete"` prima di
 * generare il blob, invece di scambiare gli ICE candidate uno alla
 * volta mentre arrivano. Verificato EMPIRICAMENTE con werift 0.23.0
 * (la versione pinnata dal progetto, non l'ultima disponibile) in uno
 * script Node getta-via: a gathering completato, `localDescription.sdp`
 * include già le righe `a=candidate` — werift fa "vanilla ICE", non
 * serve un canale separato per gli ICE candidate oltre all'SDP finale.
 *
 * STUN pubblico gratuito, NIENTE TURN (decisione utente): un NAT
 * simmetrico/restrittivo fa fallire la connessione — non gestito qui
 * (questo modulo si limita a stabilire la connessione quando possibile;
 * un `connectionState` che finisce in "failed" andrà gestito e
 * segnalato chiaramente dalla UI di Fase 6F.3, fuori scope qui).
 *
 * NOTA DI DUPLICAZIONE: `encodeBlob`/`decodeBlob` e le due label dei
 * DataChannel sono ripetute (identiche) in
 * packages/editor/src/network/tunnelGuest.ts invece di essere condivise
 * via @engine/core — @engine/core è il runtime motore/Unity-style
 * (GameObject/Transform/rendering/fisica/serializzazione scene), non ha
 * senso farci transitare un concetto di rete specifico di WebRTC per
 * poche righe di codice banali (base64+JSON, usabili identiche in
 * Node 20+ e browser grazie a `btoa`/`atob` globali in entrambi gli
 * ambienti — verificato empiricamente che Node 22 li espone stabili
 * senza warning). Le due label DEVONO restare identiche fra i due file.
 */

const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/** Nomi dei due DataChannel — devono combaciare esattamente con packages/editor/src/network/tunnelGuest.ts. */
export const CONTROL_CHANNEL_LABEL = "colyseus-tunnel-control";
export const DATA_CHANNEL_LABEL = "colyseus-tunnel-data";

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
    peerConnection.iceGatheringStateChange.subscribe((state) => {
      if (state === "complete") resolve();
    });
  });
}

function waitForDataChannelOpen(dataChannel: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    if (dataChannel.readyState === "open") {
      resolve();
      return;
    }
    dataChannel.stateChange.subscribe((state) => {
      if (state === "open") resolve();
    });
  });
}

/** Una sessione di rendez-vous host-side in corso, prima che i DataChannel siano aperti. */
export interface HostRendezvousSession {
  peerConnection: RTCPeerConnection;
  controlChannel: RTCDataChannel;
  dataChannel: RTCDataChannel;
  /** Blob (base64) da copiare e mandare al guest. */
  offerBlob: string;
}

/**
 * Avvia il lato host: crea la RTCPeerConnection + i due DataChannel,
 * genera l'offer, attende la raccolta ICE completa (non-trickle) e
 * restituisce il blob da condividere col guest fuori banda.
 */
export async function createHostOffer(): Promise<HostRendezvousSession> {
  const peerConnection = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  const controlChannel = peerConnection.createDataChannel(CONTROL_CHANNEL_LABEL, { ordered: true });
  const dataChannel = peerConnection.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIceGatheringComplete(peerConnection);

  const finalDescription = peerConnection.localDescription;
  if (!finalDescription) {
    throw new Error("localDescription assente dopo setLocalDescription — non dovrebbe accadere.");
  }

  return {
    peerConnection,
    controlChannel,
    dataChannel,
    offerBlob: encodeBlob({ type: finalDescription.type, sdp: finalDescription.sdp }),
  };
}

/**
 * Completa l'handshake lato host applicando l'answerBlob ricevuto dal
 * guest. Risolve quando ENTRAMBI i DataChannel sono aperti e pronti
 * all'uso.
 */
export async function completeHostConnection(
  session: HostRendezvousSession,
  answerBlob: string,
): Promise<void> {
  const answer = decodeBlob(answerBlob);
  if (answer.type !== "answer") {
    throw new Error(`Blob inatteso: tipo "${answer.type}", attesa "answer".`);
  }
  await session.peerConnection.setRemoteDescription(answer);
  await Promise.all([
    waitForDataChannelOpen(session.controlChannel),
    waitForDataChannelOpen(session.dataChannel),
  ]);
}
