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
 * simmetrico/restrittivo fa fallire la connessione. Fino a Fase 6F.3.b
 * questo NON era gestito qui (nessun timeout, l'attesa restava appesa
 * indefinitamente) — Fase 6F.3.d aggiunge la gestione esplicita in
 * `completeHostConnection` (vedi paragrafo "TIMEOUT/FALLIMENTO NAT" più
 * sotto): la UI riceve un errore chiaro invece di restare bloccata.
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
 *
 * TIMEOUT/FALLIMENTO NAT (Fase 6F.3.d, punto aperto 4): senza STUN
 * reachability o con NAT simmetrico, i due DataChannel non aprono mai —
 * `completeHostConnection` restava appesa indefinitamente PRIMA di questa
 * modifica (verificato leggendo il codice: nessun timeout esisteva).
 * `raceConnectionEstablishment` sotto fa "gareggiare" l'apertura dei
 * DataChannel contro due segnali di fallimento: (1) `connectionStateChange`
 * di werift che riporta "failed" — segnale diretto, esce subito quando
 * disponibile; (2) un timeout puro come rete di sicurezza, per il caso in
 * cui lo stato non transizioni mai esplicitamente (es. resta bloccato in
 * "checking"). Il timeout puro (2) è legittimo SOLO qui: questa funzione
 * viene chiamata dall'host SOLO dopo che l'utente ha già incollato
 * l'answerBlob e cliccato "Connetti" — la parte umana (copia/incolla) è
 * già finita, da qui in poi è solo rete.
 *
 * NON esiste una logica gemella con lo stesso timeout in
 * packages/editor/src/network/tunnelGuest.ts: verificato con lo
 * smoke-test manuale reale (due tab) che un timeout cieco lato guest
 * scade PRIMA che l'host abbia anche solo ricevuto il codice, perché lì
 * il timer partirebbe subito dopo `createGuestAnswer()`, quando la parte
 * umana di copia/incolla non è ancora nemmeno iniziata (a differenza di
 * qui). tunnelGuest.ts usa quindi SOLO il rilevamento diretto di
 * `connectionState === "failed"`, senza ceiling — vedi commento
 * "FALLIMENTO NAT" in quel file per i dettagli.
 *
 * Valore di default (15s) derivato dai parametri REALI di retry STUN di
 * werift-ice@0.2.2 (RETRY_RTO=50ms, RETRY_MAX=6 → una singola coppia di
 * candidati fallita esaurisce i retry in ~3.15s: 50+100+200+400+800+
 * 1600ms), con margine per più coppie di candidati in sequenza. NON
 * ancora verificato empiricamente su un vero fallimento NAT a due
 * macchine — resta nello smoke-test manuale finale di Fase 6F (vedi
 * roadmap); se risultasse impreciso in pratica, va aggiustato lì.
 */

const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/** Vedi commento "TIMEOUT/FALLIMENTO NAT" sopra per la derivazione del valore. */
export const CONNECTION_ESTABLISH_TIMEOUT_MS = 15_000;

/**
 * Interfaccia minima (non l'intera classe werift `RTCPeerConnection`) per
 * poter testare `raceConnectionEstablishment` con un finto peer che non
 * ha bisogno di una vera connessione WebRTC — solo l'evento di stato.
 */
interface ConnectionStateSource {
  readonly connectionStateChange: {
    subscribe: (
      execute: (state: "disconnected" | "closed" | "new" | "connected" | "connecting" | "failed") => void,
    ) => { unSubscribe: () => void };
  };
}

/**
 * Logica reale usata da `completeHostConnection` sotto (unico consumer in
 * produzione) — esportata anche per poterla testare in isolamento con un
 * `ConnectionStateSource` finto, senza dover forzare un vero fallimento
 * ICE (non riproducibile in modo affidabile in sandbox, vedi anche
 * rendezvous.test.ts).
 */
export function raceConnectionEstablishment(
  connectionStateSource: ConnectionStateSource,
  establishPromise: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const stateSubscription = connectionStateSource.connectionStateChange.subscribe((state) => {
      if (settled || state !== "failed") return;
      settle();
      reject(
        new Error(
          "Connessione WebRTC fallita (ICE failed) — probabile NAT simmetrico/restrittivo, nessun TURN configurato.",
        ),
      );
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settle();
      reject(
        new Error(
          `Connessione WebRTC non stabilita entro ${timeoutMs}ms — probabile NAT simmetrico/restrittivo, nessun TURN configurato.`,
        ),
      );
    }, timeoutMs);

    function settle(): void {
      settled = true;
      clearTimeout(timer);
      stateSubscription.unSubscribe();
    }

    establishPromise.then(
      () => {
        if (settled) return;
        settle();
        resolve();
      },
      (error: unknown) => {
        if (settled) return;
        settle();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

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
 * all'uso, oppure rigetta con un errore chiaro se la connessione fallisce
 * o non si stabilisce entro `timeoutMs` (default `CONNECTION_ESTABLISH_
 * TIMEOUT_MS` — vedi commento "TIMEOUT/FALLIMENTO NAT" in cima al file).
 */
export async function completeHostConnection(
  session: HostRendezvousSession,
  answerBlob: string,
  timeoutMs: number = CONNECTION_ESTABLISH_TIMEOUT_MS,
): Promise<void> {
  const answer = decodeBlob(answerBlob);
  if (answer.type !== "answer") {
    throw new Error(`Blob inatteso: tipo "${answer.type}", attesa "answer".`);
  }
  await session.peerConnection.setRemoteDescription(answer);
  await raceConnectionEstablishment(
    session.peerConnection,
    Promise.all([
      waitForDataChannelOpen(session.controlChannel),
      waitForDataChannelOpen(session.dataChannel),
    ]).then(() => undefined),
    timeoutMs,
  );
}
