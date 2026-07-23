import { Room, type Client } from "colyseus";
import { logActivity } from "./activityLog.js";
import { EditorRoomState, toTransformState, applyTransformData } from "./schema/EditorRoomState.js";
import { isCommitTransformMessage, isHydrateSceneMessage } from "./messages.js";

/**
 * EditorRoom — Fase 6A (ciclo di vita) + 6B (stato Transform sincronizzato).
 * Nessuna aggiunta/rimozione di GameObject o componenti ancora — arriva in
 * 6C/6D.
 *
 * Modello di autorità (punto 2): server-authoritative. In 6B questo si
 * traduce concretamente in: il client non muta mai `this.state` per conto
 * proprio — invia un messaggio con l'intent (`hydrateScene`/
 * `commitTransform`), il server lo valida e SOLO SE valido applica la
 * mutazione allo stato condiviso, che Colyseus ribroadcasta automaticamente
 * a tutti i client connessi.
 */
export class EditorRoom extends Room<{ state: EditorRoomState }> {
  override onCreate(): void {
    this.setState(new EditorRoomState());
    logActivity({ type: "room_created", roomId: this.roomId, timestamp: Date.now() });

    // hydrateScene: il primo client che entra "porta" lo stato corrente
    // della propria scena locale (serializzata via SceneSerializer lato
    // editor — non ancora responsabilità di questo file) per inizializzare
    // `this.state.transforms`. Idempotente per costruzione: un gameObjectId
    // già presente in `this.state.transforms` NON viene sovrascritto, per
    // non permettere a un client che si unisce più tardi (con una copia
    // locale potenzialmente stale) di rimpiazzare uno stato già sincronizzato
    // nella sessione — "server-authoritative" si applica anche qui: una
    // volta che lo stato esiste nella Room, è quello la fonte di verità, non
    // l'ultimo client che si connette.
    this.onMessage("hydrateScene", (client, message: unknown) => {
      if (!isHydrateSceneMessage(message)) return;
      let addedCount = 0;
      for (const go of message.gameObjects) {
        if (!this.state.transforms.has(go.id)) {
          this.state.transforms.set(go.id, toTransformState(go.transform));
          addedCount++;
        }
      }
      if (addedCount > 0) {
        logActivity({
          type: "scene_hydrated",
          roomId: this.roomId,
          sessionId: client.sessionId,
          gameObjectCount: addedCount,
          timestamp: Date.now(),
        });
      }
    });

    // commitTransform: inviato dal client SOLO a fine trascinamento del
    // gizmo (deciso con l'utente — non ad ogni tick, per non rendere il
    // movimento in tempo reale). Un gameObjectId sconosciuto (scena non
    // ancora hydratata, o id inventato) viene ignorato silenziosamente: non
    // c'è ancora un canale per segnalare un errore di intent al client
    // mittente, da rivalutare se necessario in una fase successiva.
    this.onMessage("commitTransform", (client, message: unknown) => {
      if (!isCommitTransformMessage(message)) return;
      const transformState = this.state.transforms.get(message.gameObjectId);
      if (!transformState) return;
      applyTransformData(transformState, message.transform);
      logActivity({
        type: "transform_committed",
        roomId: this.roomId,
        sessionId: client.sessionId,
        gameObjectId: message.gameObjectId,
        timestamp: Date.now(),
      });
    });
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
