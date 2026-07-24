/**
 * @engine/tunnel — esposizione "stile ngrok ma interna" per l'editor collaborativo.
 *
 * SCOPO: permettere a un utente che ospita l'`editor_room` di Colyseus dal
 * proprio PC, dietro NAT domestico e senza port forwarding manuale, di
 * essere raggiungibile da altri utenti dell'editor via WebRTC. Nessun
 * server di rendez-vous di terze parti (decisione utente, Fase 6F):
 * il canale di segnalazione è un codice di invito copiato/incollato
 * manualmente fra host e guest, fuori banda.
 *
 * ARCHITETTURA REALE (Fase 6F.1 + 6F.2, sostituisce il vecchio commento
 * placeholder che ipotizzava un server di rendez-vous su Hetzner — mai
 * implementato, scelta poi scartata a favore del codice manuale):
 *
 * 1. Rendez-vous a codice di invito (rendezvous.ts, questo file):
 *    l'host genera un `offerBlob` (`createHostOffer()`) dopo aver
 *    raccolto per intero i candidati ICE (non-trickle — richiesto dalla
 *    scelta del codice manuale, nessuno scambio continuo possibile).
 *    Il guest (vedi packages/editor/src/network/tunnelGuest.ts, usa le
 *    API WebRTC native del browser, non `werift`) genera a sua volta un
 *    `answerBlob` da ridare all'host (`completeHostConnection()`).
 *    Vengono aperti DUE DataChannel, "control" e "data" (vedi hostProxy.ts).
 *
 * 2. Proxy locale host-side (hostProxy.ts): collega i due DataChannel al
 *    vero `editor_room` locale (`packages/server`, avviato dall'host
 *    sulla propria macchina). NON richiede alcuna modifica al server né
 *    un transport custom lato server — verificato empiricamente che
 *    `response.protocol` (il campo che sceglierebbe il transport lato
 *    client) è un flag globale per-processo-server, incompatibile con
 *    far convivere client locali e client via tunnel sullo stesso
 *    processo. Il proxy esegue invece, per conto del guest, il vero
 *    matchmake HTTP e la vera connessione WebSocket in locale.
 *
 * 3. Lato guest (packages/editor/src/network/webrtcTransport.ts):
 *    un `fetchFn` custom tunnela la richiesta HTTP di matchmake sul
 *    canale "control" e inietta `protocol: "webrtc"` nella risposta
 *    (SOLO per questa risposta tunnelata — è così, e non con un flag
 *    server-side, che `Room.connect()` sceglie il `WebRTCTransport`
 *    invece della WebSocket di default). Un `ITransport` custom
 *    (`WebRTCTransport`, registrato in `Connection.customTransports`
 *    tramite la patch `patches/@colyseus__sdk@0.17.43.patch`) sostituisce
 *    poi la WebSocket con il DataChannel "data" già aperto.
 *
 * Verificato con un test di integrazione end-to-end reale (vedi
 * tunnelProtocol.integration.test.ts): un client @colyseus/sdk vero si
 * unisce a una room vera interamente attraverso il tunnel — fetch
 * tunnelato, iniezione del protocollo, relay WebSocket, scambio di un
 * messaggio applicativo, `room.leave()` pulito. Resta da verificare solo
 * l'interoperabilità con l'implementazione WebRTC nativa di un browser
 * reale e il vero attraversamento NAT via STUN (richiede lo smoke-test
 * manuale su due macchine/reti diverse).
 *
 * STUN pubblico gratuito, NIENTE TURN (decisione utente): un NAT
 * simmetrico/restrittivo fa fallire la connessione — da segnalare
 * chiaramente nella UI (Fase 6F.3), non gestito qui.
 */

export {
  createHostOffer,
  completeHostConnection,
  CONTROL_CHANNEL_LABEL,
  DATA_CHANNEL_LABEL,
  type HostRendezvousSession,
} from "./rendezvous.js";
export { attachHostProxy, type HostProxyOptions } from "./hostProxy.js";
