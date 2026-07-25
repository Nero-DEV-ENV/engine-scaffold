import { useEffect, useRef, useState } from "react";
import { createGuestAnswer } from "../network/tunnelGuest.js";
import { createTunnelFetchFn, registerWebRTCTransport } from "../network/webrtcTransport.js";
import { connect } from "../network/collabClient.js";
import {
  tunnelHostStateStore,
  tunnelHostConnectionStore,
  ensureTunnelHostMonitoring,
  startTunnelHostOffer,
  completeTunnelHost,
  closeTunnelHost,
} from "../network/tunnelHostClient.js";

/**
 * TunnelDialog.tsx — Fase 6F.3.d: dialog/modale col flusso a step per lo
 * scambio dei due codici (decisione utente: flusso guidato a step che
 * segue lo state machine, non un form/textarea unico né un pannello
 * fisso stile "Server locale" — Topbar.tsx non aveva ALCUN pattern di
 * dialog/modale prima di questo file, verificato).
 *
 * Due varianti indipendenti, non un'unica UI simmetrica:
 * - "host": orchestrazione della sessione tunnel su host-agent (vedi
 *   network/tunnelHostClient.ts) — NON connette l'editor dell'host alla
 *   propria room, quello resta il bottone Connect/Disconnect esistente
 *   di Topbar.tsx, indipendente da questo dialog.
 * - "join": orchestrazione interamente client-side (tunnelGuest.ts +
 *   webrtcTransport.ts), che termina chiamando `collabClient.connect()`
 *   con un `transportOverride` — dal momento in cui la Room è connessa,
 *   presence/lock/hydrate/Save/Load sono IDENTICI al percorso locale/LAN
 *   (vedi commento in cima a collabClient.ts): questo dialog può chiudersi
 *   e Topbar.tsx (bottone Disconnect, striscia presence) prende il
 *   controllo esattamente come per una connessione locale/LAN.
 *
 * Lo stato del flusso "host" vive in network/tunnelHostClient.ts
 * (persistente: sopravvive alla chiusura di questo dialog, perché la
 * sessione tunnel gira sul processo host-agent separato — riaprendo il
 * dialog si ritrova lo stato corrente). Lo stato del flusso "join" invece
 * è locale a questo componente (nessun processo separato lato guest): se
 * il dialog si chiude A METÀ di un tentativo di connessione (prima che
 * `connect()` sia andato a buon fine), il cleanup chiude esplicitamente
 * il RTCPeerConnection in corso — vedi JoinTunnelFlow sotto.
 */

export type TunnelDialogVariant = "host" | "join";

interface TunnelDialogProps {
  variant: TunnelDialogVariant;
  /** Ignorato per variant "host" (l'host non si unisce alla propria room qui). */
  displayName: string;
  onClose: () => void;
}

export function TunnelDialog({ variant, displayName, onClose }: TunnelDialogProps): JSX.Element {
  return (
    <div className="tunnel-dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="tunnel-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={variant === "host" ? "Ospita sessione tunnel" : "Unisciti via tunnel"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tunnel-dialog-header">
          <span className="tunnel-dialog-title">{variant === "host" ? "Ospita" : "Unisciti via tunnel"}</span>
          <button type="button" className="tunnel-dialog-close" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </div>
        <div className="tunnel-dialog-body">
          {variant === "host" ? <HostTunnelFlow /> : <JoinTunnelFlow displayName={displayName} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

async function copyToClipboard(text: string, onDone: (ok: boolean) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    onDone(true);
  } catch {
    onDone(false);
  }
}

function HostTunnelFlow(): JSX.Element {
  const state = tunnelHostStateStore.useValue();
  const connection = tunnelHostConnectionStore.useValue();
  const [answerInput, setAnswerInput] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ensureTunnelHostMonitoring();
  }, []);

  if (connection !== "connected") {
    return (
      <p className="tunnel-dialog-status tunnel-dialog-status-error">
        Agente locale non raggiunto — avvia start-hidden.cmd (vedi pannello "Server locale" in basso).
      </p>
    );
  }

  switch (state.status) {
    case "idle":
      return (
        <>
          <p className="tunnel-dialog-hint">Genera un codice da mandare a chi vuoi invitare.</p>
          <div className="tunnel-dialog-actions">
            <button type="button" className="topbar-button" onClick={() => void startTunnelHostOffer()}>
              Genera codice invito
            </button>
          </div>
        </>
      );
    case "generating-offer":
      return <p className="tunnel-dialog-status">Generazione codice in corso…</p>;
    case "awaiting-answer":
      return (
        <>
          <p className="tunnel-dialog-hint">1. Manda questo codice a chi vuoi invitare:</p>
          <textarea
            className="tunnel-dialog-blob"
            readOnly
            value={state.offerBlob}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="tunnel-dialog-actions">
            <button
              type="button"
              className="topbar-button"
              onClick={() => void copyToClipboard(state.offerBlob, setCopied)}
            >
              {copied ? "Copiato" : "Copia"}
            </button>
          </div>
          <p className="tunnel-dialog-hint">2. Incolla qui il codice di risposta che ricevi indietro:</p>
          <textarea
            className="tunnel-dialog-blob"
            placeholder="Incolla qui il codice di risposta…"
            value={answerInput}
            onChange={(event) => setAnswerInput(event.target.value)}
          />
          <div className="tunnel-dialog-actions">
            <button
              type="button"
              className="topbar-button"
              disabled={answerInput.trim().length === 0}
              onClick={() => void completeTunnelHost(answerInput.trim())}
            >
              Connetti
            </button>
            <button type="button" className="topbar-button" onClick={() => void closeTunnelHost()}>
              Annulla
            </button>
          </div>
        </>
      );
    case "connecting":
      return <p className="tunnel-dialog-status">Connessione in corso…</p>;
    case "connected":
      return (
        <>
          <p className="tunnel-dialog-status tunnel-dialog-status-success">
            Connesso — chi hai invitato ora può accedere alla scena.
          </p>
          <div className="tunnel-dialog-actions">
            <button type="button" className="topbar-button" onClick={() => void closeTunnelHost()}>
              Chiudi tunnel
            </button>
          </div>
        </>
      );
    case "error":
      return (
        <>
          <p className="tunnel-dialog-status tunnel-dialog-status-error">{state.message}</p>
          <div className="tunnel-dialog-actions">
            <button type="button" className="topbar-button" onClick={() => void startTunnelHostOffer()}>
              Riprova
            </button>
          </div>
        </>
      );
  }
}

type GuestStep =
  | { kind: "paste-offer" }
  | { kind: "generating-answer" }
  | { kind: "awaiting-connection"; answerBlob: string }
  | { kind: "connecting-room" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

function JoinTunnelFlow({ displayName, onClose }: { displayName: string; onClose: () => void }): JSX.Element {
  const [offerInput, setOfferInput] = useState("");
  const [step, setStep] = useState<GuestStep>({ kind: "paste-offer" });
  const [copied, setCopied] = useState(false);
  // Vedi commento in cima al file: a differenza del lato host, qui non
  // c'è un processo/stato separato che sopravvive alla chiusura del
  // dialog — mountedRef+succeededRef evitano sia un setState su
  // componente smontato sia (più importante) la chiusura ERRATA di un
  // RTCPeerConnection già usato con successo da una Room connessa: il
  // cleanup chiude il peer SOLO se il flusso non è mai arrivato a
  // "connected" (stesso spirito dell'"epoch" di TunnelHostSession lato
  // host-agent, applicato qui a un unmount invece che a un close()).
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const mountedRef = useRef(true);
  const succeededRef = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (!succeededRef.current) peerConnectionRef.current?.close();
    };
  }, []);

  async function startGuestFlow(): Promise<void> {
    const trimmedOffer = offerInput.trim();
    if (trimmedOffer.length === 0) return;
    setStep({ kind: "generating-answer" });
    try {
      const { channels, answerBlob, peerConnection } = await createGuestAnswer(trimmedOffer);
      peerConnectionRef.current = peerConnection;
      if (!mountedRef.current) return;
      setStep({ kind: "awaiting-connection", answerBlob });

      const resolvedChannels = await channels;
      if (!mountedRef.current) return;
      registerWebRTCTransport(resolvedChannels);
      setStep({ kind: "connecting-room" });

      await connect(displayName.length > 0 ? displayName : undefined, {
        url: "ws://tunnel.invalid",
        fetchFn: createTunnelFetchFn(resolvedChannels),
      });
      if (!mountedRef.current) return;
      succeededRef.current = true;
      setStep({ kind: "connected" });
    } catch (error) {
      if (!mountedRef.current) return;
      setStep({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Annulla manuale (Fase 6F.3.d — fix bug trovato con lo smoke-test
   * reale: nessun timeout automatico protegge l'attesa "awaiting-
   * connection", vedi commento "FALLIMENTO NAT" in tunnelGuest.ts — serve
   * un modo esplicito per uscire se la connessione resta bloccata senza
   * mai arrivare a "failed"). Non chiude un peerConnection già usato con
   * successo: qui non può succedere (il bottone è visibile solo prima di
   * "connected"), ma il guard su succeededRef resta comunque coerente con
   * l'unmount-cleanup sopra.
   */
  function handleCancel(): void {
    if (!succeededRef.current) peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    setStep({ kind: "paste-offer" });
  }

  switch (step.kind) {
    case "paste-offer":
      return (
        <>
          <p className="tunnel-dialog-hint">Incolla qui il codice invito ricevuto dall'host:</p>
          <textarea
            className="tunnel-dialog-blob"
            placeholder="Incolla qui il codice invito…"
            value={offerInput}
            onChange={(event) => setOfferInput(event.target.value)}
          />
          <div className="tunnel-dialog-actions">
            <button
              type="button"
              className="topbar-button"
              disabled={offerInput.trim().length === 0}
              onClick={() => void startGuestFlow()}
            >
              Genera risposta
            </button>
          </div>
        </>
      );
    case "generating-answer":
      return <p className="tunnel-dialog-status">Generazione codice di risposta…</p>;
    case "awaiting-connection":
      return (
        <>
          <p className="tunnel-dialog-hint">Manda questo codice di risposta all'host, poi attendi:</p>
          <textarea
            className="tunnel-dialog-blob"
            readOnly
            value={step.answerBlob}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="tunnel-dialog-actions">
            <button
              type="button"
              className="topbar-button"
              onClick={() => void copyToClipboard(step.answerBlob, setCopied)}
            >
              {copied ? "Copiato" : "Copia"}
            </button>
          </div>
          <p className="tunnel-dialog-status">In attesa che l'host completi la connessione…</p>
          <div className="tunnel-dialog-actions">
            <button type="button" className="topbar-button" onClick={handleCancel}>
              Annulla
            </button>
          </div>
        </>
      );
    case "connecting-room":
      return <p className="tunnel-dialog-status">Connessione alla scena in corso…</p>;
    case "connected":
      return (
        <>
          <p className="tunnel-dialog-status tunnel-dialog-status-success">Connesso.</p>
          <div className="tunnel-dialog-actions">
            <button type="button" className="topbar-button" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </>
      );
    case "error":
      return (
        <>
          <p className="tunnel-dialog-status tunnel-dialog-status-error">{step.message}</p>
          <div className="tunnel-dialog-actions">
            <button type="button" className="topbar-button" onClick={() => setStep({ kind: "paste-offer" })}>
              Riprova
            </button>
          </div>
        </>
      );
  }
}
