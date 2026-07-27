import { Room, type Client } from "colyseus";
import { logActivity } from "./activityLog.js";
import {
  EditorRoomState,
  ClientInfo,
  toTransformState,
  applyTransformData,
  toGameObjectMetaState,
  toComponentState,
  applyComponentDataToState,
  componentKey,
} from "./schema/EditorRoomState.js";
import {
  isCommitTransformMessage,
  isHydrateSceneMessage,
  isBeginEditMessage,
  isEndEditMessage,
  isAddGameObjectMessage,
  isRemoveGameObjectMessage,
  isAddComponentMessage,
  isRemoveComponentMessage,
  isUpdateComponentMessage,
} from "./messages.js";
import { resolveDisplayName, pickColor } from "./identity.js";

/**
 * EditorRoom — Fase 6A (ciclo di vita) + 6B (stato Transform sincronizzato)
 * + 6C.2 (sync aggiunta/rimozione GameObject) + 6D (sync aggiunta/
 * rimozione/modifica di componenti su un GameObject già esistente).
 *
 * Modello di autorità (punto 2): server-authoritative. In 6B questo si
 * traduce concretamente in: il client non muta mai `this.state` per conto
 * proprio — invia un messaggio con l'intent (`hydrateScene`/
 * `commitTransform`), il server lo valida e SOLO SE valido applica la
 * mutazione allo stato condiviso, che Colyseus ribroadcasta automaticamente
 * a tutti i client connessi.
 */
export class EditorRoom extends Room<{ state: EditorRoomState }> {
  /**
   * Fix Fase 6C.2 (scoperto con uno smoke-test reale, non anticipato dal
   * design iniziale): id dei GameObject rimossi DEFINITIVAMENTE tramite
   * `removeGameObject`, per tutta la vita di questa Room. Volutamente NON
   * uno Schema/campo sincronizzato (i client non hanno bisogno di
   * leggerlo) — serve solo qui, a `hydrateScene`, per distinguere "questo
   * id non è mai stato nella scena condivisa" da "questo id c'era ma è
   * stato rimosso apposta": senza questo Set, un client che si connette
   * DOPO che un oggetto pre-esistente (hydratato, quindi con un id fisso
   * hardcoded uguale in ogni client — es. "demo-cube") è stato rimosso da
   * un altro client, lo re-inserirebbe in `transforms` con il proprio
   * `hydrateScene` (che invia SEMPRE l'intera scena locale bootstrap,
   * ignara della rimozione altrui), facendolo ricomparire per tutti.
   * Volatile come il resto dello stato della Room (si azzera se la Room
   * muore) — coerente con `transforms`/`editingBy`, nessuna persistenza su
   * disco prevista finora.
   *
   * Un secondo problema, scoperto DOPO il primo smoke-test di questo fix,
   * resta distinto da questo Set: impedire la resurrezione nello stato
   * condiviso non dice al client richiedente di rimuovere la propria copia
   * locale (bootstrap hardcoded, indipendente dalla rete) dell'oggetto —
   * per quello vedi la risposta mirata `gameObjectsRemoved` nell'handler
   * `hydrateScene` sotto.
   */
  private readonly removedGameObjectIds = new Set<string>();

  /**
   * Fase 6D — mirror esatto di `removedGameObjectIds` sopra, ma per
   * componenti: chiavi composite (`gameObjectId:type`, vedi `componentKey`
   * in EditorRoomState.ts) di componenti rimossi DEFINITIVAMENTE tramite
   * `removeComponent`, per tutta la vita di questa Room. Stesso motivo
   * esatto: senza questo Set, un client che si connette DOPO che un
   * componente pre-esistente (es. il MeshRenderer di "demo-cube") è stato
   * rimosso da un altro client lo re-inserirebbe in `components` col
   * proprio `hydrateScene` (che invia SEMPRE i componenti correnti della
   * scena locale bootstrap, ignara della rimozione altrui). Non serve
   * invece tracciare qui i componenti di un GameObject rimosso per intero
   * (`removeGameObject` sotto): quel gameObjectId è già in
   * `removedGameObjectIds`, e `hydrateScene` salta i componenti di un
   * GameObject respinto senza doverli controllare uno per uno.
   */
  private readonly removedComponentKeys = new Set<string>();

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
    // l'ultimo client che si connette. Salta anche qualunque id presente in
    // `removedGameObjectIds` (vedi sopra), anche se non è (più) in
    // `transforms` — altrimenti un hydrate successivo alla rimozione lo
    // resusciterebbe.
    this.onMessage("hydrateScene", (client, message: unknown) => {
      if (!isHydrateSceneMessage(message)) return;
      let addedCount = 0;
      const rejectedIds: string[] = [];
      const rejectedComponentKeys: string[] = [];
      for (const go of message.gameObjects) {
        if (this.removedGameObjectIds.has(go.id)) {
          rejectedIds.push(go.id);
          // I componenti di un GameObject respinto non vengono processati:
          // il GameObject stesso non esisterà comunque per il client
          // richiedente (vedi gameObjectsRemoved sotto), quindi non c'è
          // motivo di controllare i suoi componenti uno per uno qui.
          continue;
        }
        if (!this.state.transforms.has(go.id)) {
          this.state.transforms.set(go.id, toTransformState(go.transform));
          addedCount++;
        }
        // Fase 6D: hydrate dei componenti CORRENTI di questo GameObject,
        // stessa idempotenza/rejection di `transforms` sopra ma a livello
        // di singolo componente (chiave composita, vedi `componentKey`).
        for (const componentData of go.components) {
          const key = componentKey(go.id, componentData.type);
          if (this.removedComponentKeys.has(key)) {
            rejectedComponentKeys.push(key);
            continue;
          }
          if (!this.state.components.has(key)) {
            this.state.components.set(key, toComponentState(go.id, componentData));
          }
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
      // Risposta MIRATA (solo a `client`, non broadcast): vedi JSDoc di
      // GameObjectsRemovedMessage in messages.ts. Nessun invio se
      // rejectedIds è vuoto — il caso comune (nessun oggetto rimosso da
      // hydratare) non deve generare traffico extra.
      if (rejectedIds.length > 0) {
        client.send("gameObjectsRemoved", { gameObjectIds: rejectedIds });
      }
      // Fase 6D: stesso discorso di gameObjectsRemoved sopra, ma per
      // componenti — vedi JSDoc di ComponentsRemovedMessage in messages.ts.
      if (rejectedComponentKeys.length > 0) {
        client.send("componentsRemoved", { componentKeys: rejectedComponentKeys });
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

    // addGameObject (Fase 6C.2): id generato dal client (ottimistico, stesso
    // approccio già usato per gli id degli oggetti hydratati) — il server
    // resta autoritativo perché rifiuta un id già presente in `transforms`
    // (duplicato). `transforms` riceve il Transform iniziale, `gameObjectMeta`
    // riceve kind+name: le due mappe sono sempre scritte insieme qui, così
    // `transforms` resta l'unica fonte di verità su "questo GameObject esiste
    // nella scena condivisa" sia per gli oggetti hydratati sia per quelli
    // aggiunti a runtime (vedi EditorRoomState.ts).
    this.onMessage("addGameObject", (client, message: unknown) => {
      if (!isAddGameObjectMessage(message)) return;
      if (this.state.transforms.has(message.id)) return;
      this.state.transforms.set(message.id, toTransformState(message.transform));
      this.state.gameObjectMeta.set(message.id, toGameObjectMetaState(message.kind, message.name));
      // Fase 6D: componenti iniziali (opzionali) — vedi JSDoc di
      // `AddGameObjectMessage.components` in messages.ts sul perché sono
      // sincronizzati nello STESSO messaggio invece di un `addComponent`
      // separato subito dopo.
      for (const componentData of message.components ?? []) {
        this.state.components.set(componentKey(message.id, componentData.type), toComponentState(message.id, componentData));
      }
      logActivity({
        type: "gameobject_added",
        roomId: this.roomId,
        sessionId: client.sessionId,
        gameObjectId: message.id,
        timestamp: Date.now(),
      });
    });

    // removeGameObject (Fase 6C.2): un gameObjectId sconosciuto (mai
    // hydratato/aggiunto, o già rimosso da un altro client nel frattempo)
    // viene ignorato silenziosamente, stesso stile di commitTransform su un
    // id sconosciuto. Un gameObjectId lockato da un ALTRO client blocca la
    // rimozione (stesso pattern "richiesta ignorata silenziosamente" già
    // usato da beginEdit per un conflitto di lock) — un client può comunque
    // rimuovere un oggetto che ha lockato lui stesso. `gameObjectMeta.delete`
    // è un no-op sicuro quando l'oggetto rimosso era pre-esistente (mai
    // avuto un'entry lì) — verificato in EditorRoomState.test.ts.
    // `editingBy.delete` è incondizionato per evitare lock orfani.
    //
    // Fase 6D: ripulisce anche ogni entry di `components` appartenente a
    // questo gameObjectId (raccogli-poi-cancella, stesso stile della
    // pulizia di `editingBy` orfano in `onLeave` sotto, per non mutare
    // `components` durante la propria iterazione). Nessuna aggiunta a
    // `removedComponentKeys` necessaria qui: il gameObjectId è già in
    // `removedGameObjectIds`, quindi `hydrateScene` salta i suoi componenti
    // a monte (vedi sopra), senza bisogno di tracciarli uno per uno.
    this.onMessage("removeGameObject", (client, message: unknown) => {
      if (!isRemoveGameObjectMessage(message)) return;
      if (!this.state.transforms.has(message.gameObjectId)) return;
      const lockHolder = this.state.editingBy.get(message.gameObjectId);
      if (lockHolder && lockHolder !== client.sessionId) return;
      this.state.transforms.delete(message.gameObjectId);
      this.state.gameObjectMeta.delete(message.gameObjectId);
      this.state.editingBy.delete(message.gameObjectId);
      this.removedGameObjectIds.add(message.gameObjectId);
      const orphanedComponentKeys = Array.from(this.state.components.keys()).filter(
        (key) => this.state.components.get(key)?.gameObjectId === message.gameObjectId,
      );
      for (const key of orphanedComponentKeys) {
        this.state.components.delete(key);
      }
      logActivity({
        type: "gameobject_removed",
        roomId: this.roomId,
        sessionId: client.sessionId,
        gameObjectId: message.gameObjectId,
        timestamp: Date.now(),
      });
    });

    // addComponent (Fase 6D): aggiunge un componente a un GameObject già
    // esistente. Ignorato silenziosamente se: il gameObjectId non esiste
    // (mai hydratato/aggiunto), il tipo di componente esiste già su quel
    // gameObjectId (mirror del vincolo di GameObject.addComponent nel
    // motore — vedi core/GameObject.ts), o il gameObjectId è lockato da un
    // ALTRO client (stesso pattern di removeGameObject sopra).
    this.onMessage("addComponent", (client, message: unknown) => {
      if (!isAddComponentMessage(message)) return;
      if (!this.state.transforms.has(message.gameObjectId)) return;
      const lockHolder = this.state.editingBy.get(message.gameObjectId);
      if (lockHolder && lockHolder !== client.sessionId) return;
      const key = componentKey(message.gameObjectId, message.component.type);
      if (this.state.components.has(key)) return;
      this.state.components.set(key, toComponentState(message.gameObjectId, message.component));
      logActivity({
        type: "component_added",
        roomId: this.roomId,
        sessionId: client.sessionId,
        gameObjectId: message.gameObjectId,
        componentType: message.component.type,
        timestamp: Date.now(),
      });
    });

    // removeComponent (Fase 6D): rimuove un componente esistente. Ignorato
    // silenziosamente se il gameObjectId non esiste, il componente non è
    // presente (mai aggiunto, o già rimosso da un altro client nel
    // frattempo), o il gameObjectId è lockato da un ALTRO client.
    this.onMessage("removeComponent", (client, message: unknown) => {
      if (!isRemoveComponentMessage(message)) return;
      if (!this.state.transforms.has(message.gameObjectId)) return;
      const lockHolder = this.state.editingBy.get(message.gameObjectId);
      if (lockHolder && lockHolder !== client.sessionId) return;
      const key = componentKey(message.gameObjectId, message.type);
      if (!this.state.components.has(key)) return;
      this.state.components.delete(key);
      this.removedComponentKeys.add(key);
      logActivity({
        type: "component_removed",
        roomId: this.roomId,
        sessionId: client.sessionId,
        gameObjectId: message.gameObjectId,
        componentType: message.type,
        timestamp: Date.now(),
      });
    });

    // updateComponent (Fase 6D): aggiorna i campi di un componente già
    // presente — semantica OPPOSTA di addComponent (fallisce se il
    // componente NON esiste ancora, invece che se esiste già). Stesso
    // controllo di lock delle altre due.
    this.onMessage("updateComponent", (client, message: unknown) => {
      if (!isUpdateComponentMessage(message)) return;
      if (!this.state.transforms.has(message.gameObjectId)) return;
      const lockHolder = this.state.editingBy.get(message.gameObjectId);
      if (lockHolder && lockHolder !== client.sessionId) return;
      const key = componentKey(message.gameObjectId, message.component.type);
      const componentState = this.state.components.get(key);
      if (!componentState) return;
      applyComponentDataToState(componentState, message.component);
      logActivity({
        type: "component_updated",
        roomId: this.roomId,
        sessionId: client.sessionId,
        gameObjectId: message.gameObjectId,
        componentType: message.component.type,
        timestamp: Date.now(),
      });
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
