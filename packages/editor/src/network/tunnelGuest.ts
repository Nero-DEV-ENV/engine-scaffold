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
 *
 * FALLIMENTO NAT (Fase 6F.3.d, punto aperto 4) — STORIA: la prima
 * versione qui aggiungeva un timeout cieco (15s, gemello di
 * `CONNECTION_ESTABLISH_TIMEOUT_MS` in rendezvous.ts) attorno all'intera
 * attesa di `channels`. BUG TROVATO CON LO SMOKE-TEST REALE (due tab,
 * stessa macchina): quel timer parte quando `createGuestAnswer` viene
 * chiamata, cioè SUBITO dopo che l'utente clicca "Genera risposta" — ma
 * la connessione vera non può ancora iniziare a quel punto, perché
 * l'host deve prima ricevere l'answerBlob (copia/incolla manuale, tempo
 * UMANO) e chiamare `completeHostConnection` dal suo lato. Il timer
 * contava quel tempo umano come parte del tentativo di rete e scadeva
 * prima ancora che l'utente finisse di incollare il codice. Lato host
 * questo problema NON esiste (vedi rendezvous.ts): `completeHostConnection`
 * viene chiamata SOLO dopo che l'host ha già incollato la risposta — la
 * parte umana è già finita quando il timeout lì inizia a contare.
 *
 * FIX: nessun timeout cieco qui. Resta SOLO il rilevamento diretto di
 * `connectionState === "failed"` (segnale reale, sicuro da usare in
 * qualunque momento arrivi — non richiede indovinare quanto tempo
 * concedere alla parte umana). Se la connessione resta bloccata senza mai
 * arrivare a "failed", l'utente può annullare manualmente dal dialog
 * (vedi TunnelDialog.tsx, bottone "Annulla" nel passo "awaiting-
 * connection") — stesso pattern già in uso lato host per la sua attesa
 * altrettanto non temporizzata ("awaiting-answer" → bottone "Annulla").
 * Non verificabile con un test automatico: `RTCPeerConnection` è
 * un'API browser nativa, non disponibile nell'ambiente Node dei test
 * Vitest di questo pacchetto (nessun jsdom/happy-dom configurato —
 * verificato, e comunque nessuno dei due implementa un vero stack
 * WebRTC). Verificato solo dallo smoke-test manuale in browser reale.
 */

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Fa rigettare `establishPromise` (l'apertura dei DataChannel) SOLO se
 * `connectionState` arriva a "failed" — nessun timeout cieco, vedi
 * commento "FALLIMENTO NAT" in cima al file per il perché.
 */
function rejectOnConnectionFailure<T>(peerConnection: RTCPeerConnection, establishPromise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const onConnectionStateChange = (): void => {
      if (settled || peerConnection.connectionState !== "failed") return;
      settle();
      reject(
        new Error(
          "Connessione WebRTC fallita (ICE failed) — probabile NAT simmetrico/restrittivo, nessun TURN configurato.",
        ),
      );
    };
    peerConnection.addEventListener("connectionstatechange", onConnectionStateChange);

    function settle(): void {
      settled = true;
      peerConnection.removeEventListener("connectionstatechange", onConnectionStateChange);
    }

    establishPromise.then(
      (value) => {
        if (settled) return;
        settle();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settle();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

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
  /**
   * Risolve quando ENTRAMBI i DataChannel creati dall'host sono arrivati
   * (aperti li apre poi webrtcTransport.ts/hostProxy.ts), oppure rigetta
   * con un errore chiaro se la connessione fallisce (`connectionState`
   * arriva a "failed" — vedi commento "FALLIMENTO NAT" in cima al file).
   * NESSUN timeout automatico: può restare in attesa a lungo mentre
   * l'host completa la sua parte a mano — l'utente può annullare
   * manualmente dal dialog se impiega troppo (vedi TunnelDialog.tsx).
   */
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

  const rawChannels = new Promise<{ controlChannel: RTCDataChannel; dataChannel: RTCDataChannel }>((resolve) => {
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
  const channels = rejectOnConnectionFailure(peerConnection, rawChannels);
  // Il chiamante attende `channels` solo DOPO aver rimandato l'answerBlob
  // all'host (vedi uso documentato sopra) — un gap di tempo reale non
  // sotto il nostro controllo. Se il rigetto arriva prima che qualcuno
  // attacchi un handler, senza questo `.catch` a vuoto risulterebbe un
  // unhandled rejection: questo listener silenzioso non altera cosa
  // riceve chi attende `channels` più avanti (catene di Promise
  // indipendenti), serve solo a evitare il warning.
  channels.catch(() => {});

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
