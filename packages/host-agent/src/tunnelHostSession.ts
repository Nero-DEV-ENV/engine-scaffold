import { EventEmitter } from "node:events";
import {
  createHostOffer,
  completeHostConnection,
  attachHostProxy,
  type HostRendezvousSession,
} from "@engine/tunnel";

/**
 * tunnelHostSession.ts — Fase 6F.3.b. A differenza di ProcessSupervisor
 * (che spawna PROCESSI FIGLI esterni), questo modulo chiama direttamente
 * `createHostOffer()`/`completeHostConnection()`/`attachHostProxy()` di
 * @engine/tunnel IN-PROCESS, nello stesso processo Node di host-agent —
 * non c'è nulla da spawnare, è codice libreria (werift gira comunque solo
 * su Node, mai nel browser: per questo vive qui e non nell'editor).
 *
 * UNA SOLA sessione tunnel alla volta (stesso vincolo di ProcessSupervisor
 * per packages/server — niente sessioni concorrenti).
 *
 * Il controllo "packages/server deve essere in esecuzione prima di poter
 * ospitare" è deliberatamente ASSENTE qui (decisione utente, Fase 6F.3.b):
 * resta responsabilità della UI (disabilitare il bottone "Ospita" finché
 * il pannello "Server locale" non è "running"), non di questo modulo —
 * se chiamato comunque a server fermo, il proxy semplicemente fallirà le
 * fetch/WS verso colyseusHttpUrl (già gestito da hostProxy.ts con
 * fetch-result status 502).
 */

export type TunnelHostState =
  | { status: "idle" }
  | { status: "generating-offer" }
  | { status: "awaiting-answer"; offerBlob: string }
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "error"; message: string };

export interface TunnelHostSessionOptions {
  /** Base HTTP dell'editor_room locale, es. "http://localhost:2567". */
  colyseusHttpUrl: string;
}

export class TunnelHostSession extends EventEmitter {
  private readonly colyseusHttpUrl: string;
  private state: TunnelHostState = { status: "idle" };
  private session: HostRendezvousSession | undefined;
  // Incrementato ad ogni close(): invalida i risultati di operazioni async
  // (startOffer/complete) ancora in volo quando l'utente chiude/riavvia
  // la sessione nel frattempo — stesso schema difensivo di
  // ProcessSupervisor ("currentChild === child") applicato qui alle
  // Promise invece che agli eventi di child_process.
  private epoch = 0;

  constructor(options: TunnelHostSessionOptions) {
    super();
    this.colyseusHttpUrl = options.colyseusHttpUrl;
  }

  getState(): TunnelHostState {
    return this.state;
  }

  /**
   * Avvia una nuova sessione: genera l'offerBlob (attende la raccolta ICE
   * completa, non-trickle — vedi rendezvous.ts). No-op (ritorna false) se
   * lo stato non è idle/error.
   */
  async startOffer(): Promise<boolean> {
    if (this.state.status !== "idle" && this.state.status !== "error") return false;
    const myEpoch = ++this.epoch;
    this.setState({ status: "generating-offer" });
    try {
      const session = await createHostOffer();
      if (myEpoch !== this.epoch) {
        // close() chiamato nel frattempo: scarta questo risultato stale.
        void session.peerConnection.close();
        return false;
      }
      this.session = session;
      this.setState({ status: "awaiting-answer", offerBlob: session.offerBlob });
      return true;
    } catch (error) {
      if (myEpoch !== this.epoch) return false;
      this.session = undefined;
      this.setState({
        status: "error",
        message: `Generazione offer fallita: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
  }

  /**
   * Completa l'handshake con l'answerBlob del guest e aggancia il proxy
   * verso l'editor_room locale. No-op (ritorna false) se non si è in
   * awaiting-answer.
   */
  async complete(answerBlob: string): Promise<boolean> {
    if (this.state.status !== "awaiting-answer" || !this.session) return false;
    const myEpoch = this.epoch;
    const session = this.session;
    this.setState({ status: "connecting" });
    try {
      await completeHostConnection(session, answerBlob);
      if (myEpoch !== this.epoch) return false;
      attachHostProxy(session, { colyseusHttpUrl: this.colyseusHttpUrl });
      this.setState({ status: "connected" });
      return true;
    } catch (error) {
      if (myEpoch !== this.epoch) return false;
      this.setState({
        status: "error",
        message: `Completamento connessione fallito: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
  }

  /** Chiude la sessione tunnel corrente (se esiste) e torna a idle. No-op (ritorna false) se già idle. */
  close(): boolean {
    if (this.state.status === "idle") return false;
    this.epoch++;
    if (this.session) void this.session.peerConnection.close();
    this.session = undefined;
    this.setState({ status: "idle" });
    return true;
  }

  private setState(next: TunnelHostState): void {
    this.state = next;
    this.emit("state", next);
  }
}
