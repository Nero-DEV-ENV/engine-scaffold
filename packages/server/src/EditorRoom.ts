import { Room, type Client } from "colyseus";
import { logActivity } from "./activityLog.js";

/**
 * EditorRoom — Fase 6A: solo ciclo di vita della stanza/connessione
 * (verifica end-to-end che client `@colyseus/sdk` e server dialoghino nel
 * monorepo). Nessuno stato di scena sincronizzato ancora — arriva in Fase
 * 6B (`@colyseus/schema`, sync Transform) e oltre.
 *
 * Modello di autorità deciso con l'utente (punto 2): server-authoritative.
 * Non rilevante ancora in 6A (nessun intent client da validare), ma la
 * Room resta il punto in cui quella logica verrà aggiunta.
 */
export class EditorRoom extends Room {
  override onCreate(): void {
    logActivity({ type: "room_created", roomId: this.roomId, timestamp: Date.now() });
  }

  override onJoin(client: Client): void {
    logActivity({
      type: "client_joined",
      roomId: this.roomId,
      sessionId: client.sessionId,
      timestamp: Date.now(),
    });
  }

  override onLeave(client: Client, code?: number): void {
    logActivity({
      type: "client_left",
      roomId: this.roomId,
      sessionId: client.sessionId,
      code,
      timestamp: Date.now(),
    });
  }

  override onDispose(): void {
    logActivity({ type: "room_disposed", roomId: this.roomId, timestamp: Date.now() });
  }
}
