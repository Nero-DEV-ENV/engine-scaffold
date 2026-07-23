/**
 * @engine/tunnel — esposizione "stile ngrok ma interna" per l'editor collaborativo.
 *
 * SCOPO (deciso in sessione, nessun codice funzionale ancora — solo scaffold):
 * permettere a un utente che ospita l'`editor_room` di Colyseus dal proprio PC,
 * dietro NAT domestico e senza port forwarding manuale, di essere raggiungibile
 * da altri utenti dell'editor. Zero budget, zero relay di terze parti, totale
 * libertà dell'utente (feature opt-in, "bring your own" rendez-vous).
 *
 * ARCHITETTURA CONFERMATA:
 * - Colyseus stesso resta invariato: WebSocket su TCP (`ws://localhost:2567`),
 *   nessuna modifica al Transport lato server di @colyseus/core.
 * - Un canale WebRTC DataChannel viene stabilito fra il processo host (Node,
 *   via `werift`) e ciascun client browser che si unisce, tramite:
 *     - un piccolo server di rendez-vous (WebSocket) che relaia SOLO
 *       SDP offer/answer + candidati ICE — mai un byte di stato Transform/scena;
 *     - STUN pubblico e gratuito (es. stun.l.google.com) per la scoperta
 *       dell'IP pubblico; NIENTE TURN di fallback per design (se entrambi i
 *       peer sono dietro NAT simmetrico la connessione diretta fallisce e va
 *       segnalato chiaramente, non instradato silenziosamente su un relay terzo).
 * - Lato client, un `WebRTCTransport implements ITransport` (interfaccia
 *   ufficiale e già pluggable di @colyseus/sdk) viene registrato tramite la
 *   patch `patches/@colyseus__sdk@0.17.43.patch` (`Connection.customTransports`)
 *   e usato passando `{ protocol: "webrtc" }` alle opzioni di connessione.
 *
 * VERIFICATO EMPIRICAMENTE IN QUESTA SESSIONE:
 * - @colyseus/sdk espone `ITransport`/`Connection.customTransports` (patch
 *   pnpm generata e committata, pipeline pulita riconfermata verde: 91 test).
 * - `werift` è pura TypeScript/JS, zero compilazione nativa — scelta preferita
 *   a `node-datachannel` per coerenza con il resto del monorepo (Rapier WASM
 *   inlineato, niente step di compilazione nativa in nessun altro pacchetto).
 *
 * NON ANCORA DECISO / NON ANCORA SCRITTO (in attesa di suddivisione in
 * sotto-fasi con l'utente — vedi punto 5 del documento di sessione):
 * - punto 4: URL del server lato client (costante vs env var Vite) — dipende
 *   in parte da come si configura il rendez-vous "bring your own".
 * - implementazione reale di rendez-vous, STUN wiring, `WebRTCTransport`,
 *   proxy locale host-side verso `ws://localhost:2567`.
 */

export {};
