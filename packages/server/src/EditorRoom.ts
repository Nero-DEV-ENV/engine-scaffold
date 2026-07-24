import { Room, type Client } from "colyseus";
import { logActivity } from "./activityLog.js";
import { EditorRoomState, ClientInfo, toTransformState, applyTransformData } from "./schema/EditorRoomState.js";
import { isCommitTransformMessage, isHydrateSceneMessage, isBeginEditMessage, isEndEditMessage } from "./messages.js";
import { resolveDisplayName, pickColor } from "./identity.js";

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

    // beginEdit/endEdit: lock ottimistico di editing (Fase 6B.client-2),
    // inviato dallo stesso hook `dragging-changed` di createEditorScene.ts
    // che già invia commitTransform (beginEdit a inizio drag, endEdit +
    // commitTransform a fine drag). Nessun timeout: il rilascio è garantito
    // dallo stesso evento che chiude il drag lato client, più la pulizia
    // in onLeave sotto per il caso di disconnessione a metà drag.
    //
    // "Primo che arriva vince": se `gameObjectId` è già lockato da un
    // sessionId diverso, la richiesta viene ignorata silenziosamente (come
    // già fatto per un gameObjectId sconosciuto in commitTransform) — non
    // c'è ancora un canale per segnalare un conflitto di intent al client.
    this.onMessage("beginEdit", (client, message: unknown) => {
      if (!isBeginEditMessage(message)) return;
      const currentHolder = this.state.editingBy.get(message.gameObjectId);
      if (currentHolder && currentHolder !== client.sessionId) return;
      this.state.editingBy.set(message.gameObjectId, client.sessionId);
    });

    // Solo chi detiene il lock può rilasciarlo: un endEdit "in ritardo" da
    // parte di un client che nel frattempo ha perso/non ha mai avuto il
    // lock su quel gameObjectId non deve poter cancellare il lock
    // eventualmente già preso da un altro client nel frattempo.
    this.onMessage("endEdit", (client, message: unknown) => {
      if (!isEndEditMessage(message)) return;
      if (this.state.editingBy.get(message.gameObjectId) !== client.sessionId) return;
      this.state.editingBy.delete(message.gameObjectId);
    });
  }

  // Identità leggera (Fase 6B.client-2): `options.displayName`, se fornito
  // dal client, è quello scelto dall'utente stesso (owner della propria
  // identità, coerente con Unreal Multi-User Editing) — sanificato e usato
  // così com'è; solo in mancanza di un valore valido ricadiamo su un nome
  // generato proceduralmente. Il colore invece è sempre e solo deciso qui
  // (mai dal client), dalla palette fissa in identity.ts, evitando
  // collisioni con i colori già in uso dai client già connessi quando
  // possibile. Nessun account/persistenza: l'identità vive solo per la
  // durata della connessione, ricreata da zero ad ogni join.
  override onJoin(client: Client, options?: unknown): void {
    const displayNameOption =
      typeof options === "object" && options !== null
        ? (options as Record<string, unknown>).displayName
        : undefined;

    const info = new ClientInfo();
    info.name = resolveDisplayName(displayNameOption);
    info.color = pickColor(new Set(Array.from(this.state.clients.values(), (c) => c.color)));
    this.state.clients.set(client.sessionId, info);

    logActivity({
      type: "client_joined",
      roomId: this.roomId,
      sessionId: client.sessionId,
      timestamp: Date.now(),
    });
  }

  override onLeave(client: Client, code?: number): void {
    this.state.clients.delete(client.sessionId);

    // Pulizia di un editingBy orfano (deciso con l'utente, in scope per
    // questa fase): se il client disconnesso aveva un lock di editing in
    // corso su qualche gameObjectId (drag interrotto da una disconnessione
    // improvvisa, senza un endEdit mai inviato), l'entry va rimossa qui —
    // altrimenti resterebbe bloccata per tutti gli altri client per
    // sempre. Raccogliamo prima le chiavi da rimuovere e cancelliamo dopo,
    // invece di mutare `editingBy` durante l'iterazione del suo stesso
    // `.entries()`.
    const orphanedLocks = Array.from(this.state.editingBy.entries())
      .filter(([, sessionId]) => sessionId === client.sessionId)
      .map(([gameObjectId]) => gameObjectId);
    for (const gameObjectId of orphanedLocks) {
      this.state.editingBy.delete(gameObjectId);
    }

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
