import { Schema, type, MapSchema } from "@colyseus/schema";
import type { TransformData, ComponentData } from "@engine/core";

/**
 * EditorRoomState.ts — stato condiviso della Fase 6B: solo Transform dei
 * GameObject esistenti (deciso con l'utente: aggiunta/rimozione GameObject
 * e componenti arrivano in 6C/6D).
 *
 * Predisposto per l'ampliamento futuro richiesto esplicitamente dall'utente:
 * `transforms` è una MapSchema keyed per `gameObjectId`, non un array o una
 * struttura a dimensione fissa — aggiungere/rimuovere entry (6C) sarà un
 * `.set()`/`.delete()` su questa stessa mappa, senza dover restrutturare lo
 * schema. Allo stesso modo, 6D (componenti) potrà aggiungere una seconda
 * MapSchema affiancata (es. `components`) seguendo lo stesso pattern, invece
 * di dover ridisegnare EditorRoomState da capo.
 *
 * NOTA TOOLING (verificato empiricamente, non assumibile dalla sola
 * documentazione/training): @colyseus/schema 4.x richiede i decorator
 * TypeScript "legacy" (`experimentalDecorators: true`), non i nuovi
 * decorator nativi TC39 Stage 3 che il resto del monorepo usa di default
 * (tsconfig.base.json non imposta `experimentalDecorators`, quindi TS usa i
 * decorator moderni) — E richiede ANCHE `useDefineForClassFields: false`
 * quando il target è ES2022+ (il nostro caso), altrimenti `@type()` non
 * aggancia correttamente gli accessor get/set su cui si basa il change
 * tracking. Impostato solo in `packages/server/tsconfig.json` (override
 * locale), non nel tsconfig.base.json condiviso — verificato che il resto
 * del monorepo non usa decorator e non è quindi impattato.
 *
 * I nomi dei campi rispecchiano deliberatamente `TransformData` di
 * `@engine/core` (position/rotation/scale, quaternion non euler — stessa
 * scelta e stessa motivazione di `packages/core/src/serialization/types.ts`)
 * per rendere diretta la conversione da/verso `SceneSerializer` in futuro.
 *
 * Fase 6B.client-2 aggiunge due campi, entrambi MapSchema per lo stesso
 * motivo di `transforms` sopra (aggiungere/rimuovere un'entry è un
 * `.set()`/`.delete()`, nessuna restrutturazione dello schema):
 * - `clients`: identità leggera (nome+colore) di ogni client connesso,
 *   keyed per sessionId — vedi `identity.ts` per come vengono generati.
 * - `editingBy`: lock ottimistico di editing, keyed per `gameObjectId`, con
 *   valore il sessionId del client che ha in corso un drag su
 *   quell'oggetto (NON il colore/nome — quelli si risolvono lato client
 *   da `clients.get(sessionId)`, per non duplicare l'identità in due
 *   punti). MapSchema<string>: valore primitivo, non Schema annidato —
 *   niente sottigliezza di onChange su sotto-istanze (vedi il commento
 *   equivalente in collabClient.ts).
 *
 * Fase 6C.2 aggiunge `gameObjectMeta`: `transforms` resta l'UNICA fonte di
 * verità su "questo GameObject esiste nella scena condivisa" (include sia
 * gli oggetti hydratati all'avvio sia quelli aggiunti a runtime via
 * `addGameObject`) — `gameObjectMeta` esiste SOLO per gli oggetti aggiunti a
 * runtime (kind+name, il minimo per poterli ricreare su un client che non
 * li ha ancora in locale); un oggetto hydratato via `hydrateScene` non ha
 * un'entry qui, perché ogni client lo possiede già localmente dalla propria
 * scena iniziale. `EditorRoom.ts` mantiene le due mappe in lockstep
 * (`.set()`/`.delete()` sempre insieme in `addGameObject`/`removeGameObject`)
 * — `gameObjectMeta.delete()` su un id senza entry (caso di un oggetto
 * pre-esistente rimosso) è un no-op sicuro, verificato empiricamente in
 * EditorRoomState.test.ts.
 *
 * Fase 6D aggiunge `components`: sync di aggiunta/rimozione/modifica di
 * componenti (MeshRenderer/Light/RigidBody/BoxCollider/SphereCollider) su
 * un GameObject già esistente. Vedi il JSDoc di `ComponentState` sotto per
 * la forma esatta e il perché di `dataJson` invece di campi per-property.
 *
 * Fase 10E aggiunge `manifestEntries`: sync del MANIFEST della project
 * folder (percorsi/nome/tipo di ogni file/cartella scansionato, MAI i
 * byte — vedi decisione architetturale di Fase 10). Mappa PIATTA per
 * percorso relativo dell'ENTRY stessa (non annidata per cartella), stesso
 * motivo di `components` sopra con chiave composita: più semplice da
 * aggiornare/testare di una struttura ad albero, e coerente con lo stato
 * locale a mappa piatta di `projectTreeState.ts` lato editor. Vedi JSDoc di
 * `ManifestEntryState` sotto per la forma esatta e il modello di autorità
 * (nessuna, deciso con l'utente).
 */

export class Vector3State extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
}

export class QuaternionState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") w = 1;
}

export class TransformState extends Schema {
  @type(Vector3State) position = new Vector3State();
  @type(QuaternionState) rotation = new QuaternionState();
  @type(Vector3State) scale = new Vector3State();
}

/** Identità leggera di un client connesso (Fase 6B.client-2): nome+colore, non persistente. */
export class ClientInfo extends Schema {
  @type("string") name = "";
  @type("string") color = "";
}

/**
 * Metadato minimo di un GameObject aggiunto a runtime (Fase 6C.2): solo
 * quanto serve a un client che non lo possiede ancora localmente per
 * ricrearlo (vedi `EditorSceneHandle.addGameObject` in createEditorScene.ts,
 * che accetta esattamente kind+name+id+transform). `kind` è "string" (non un
 * literal union): @colyseus/schema non ha un modo nativo di vincolare un
 * @type("string") a un set di valori — la validazione del kind avviene lato
 * server in messages.ts PRIMA di scrivere qui, e lato client castando alla
 * lettura (stesso compromesso già accettato altrove nel monorepo per i dati
 * che attraversano un confine di rete/serializzazione, es. `MeshShape.kind`
 * in @engine/core).
 */
export class GameObjectMetaState extends Schema {
  @type("string") kind = "empty";
  @type("string") name = "";
}

/**
 * Stato sincronizzato di un componente su un GameObject (Fase 6D). Chiave
 * nella mappa `EditorRoomState.components`: `` `${gameObjectId}:${type}` ``
 * (composita — vedi `componentKey` sotto) invece di un id proprio generato
 * dal client, perché `GameObject.addComponent` (core/GameObject.ts) vieta
 * già due componenti dello stesso tipo esatto sullo stesso GameObject: la
 * coppia (gameObjectId, type) è quindi GIÀ un identificatore univoco a
 * livello di motore, un id aggiuntivo sarebbe ridondante.
 *
 * `dataJson` invece di campi Colyseus per-property (come fatto per
 * `TransformState`): i cinque tipi di componente (MeshRenderer/Light/
 * RigidBody/BoxCollider/SphereCollider) hanno insiemi di campi troppo
 * eterogenei per una superset-schema senza sprecare campi inutilizzati per
 * ogni istanza — stesso compromesso "string, validato/castato ai bordi" già
 * accettato per `GameObjectMetaState.kind` (vedi sopra), esteso qui
 * all'intero `ComponentData` invece che al solo discriminante. La
 * validazione avviene in messages.ts PRIMA di scrivere qui (mai un
 * `ComponentData` non validato entra in `dataJson`).
 *
 * `gameObjectId`/`type` duplicati come campi propri (oltre a far parte
 * della chiave composita) per evitare che consumer client-side debbano fare
 * parsing di stringhe per risalire all'uno o all'altro — costo trascurabile
 * (due stringhe), robustezza maggiore.
 */
export class ComponentState extends Schema {
  @type("string") gameObjectId = "";
  @type("string") type = "";
  @type("string") dataJson = "{}";
}

/**
 * Sentinel per la project root stessa (Fase 10E) — stesso valore esatto di
 * `PROJECT_TREE_ROOT_PATH` in `packages/editor/src/panels/projectTreeState.ts`
 * (duplicato qui, non condiviso: server ed editor non condividono un
 * modulo comune per questo confine, stesso principio già seguito per
 * `ProjectEntry` in `network/projectFolderClient.ts`).
 */
export const MANIFEST_ROOT_PATH = ".";

/**
 * Stato sincronizzato di UNA entry del manifest della project folder
 * (Fase 10E). Chiave nella mappa `EditorRoomState.manifestEntries`: il
 * percorso relativo dell'entry stessa (`manifestEntryPath(parentPath,
 * name)` sotto) — es. "Assets/model.glb", o "Assets" per un'entry di primo
 * livello (`parentPath === MANIFEST_ROOT_PATH`).
 *
 * `parentPath` è duplicato come campo proprio (oltre a far parte
 * implicitamente della chiave) per permettere a `EditorRoom.ts` di trovare
 * "tutte le entry di un livello" filtrando per questo campo, senza dover
 * fare parsing della chiave stessa — stesso compromesso già accettato per
 * `gameObjectId`/`type` duplicati in `ComponentState` sopra.
 *
 * Modello di autorità (punto 2 del documento di continuazione, confermato
 * dall'utente): NESSUNA. Qualunque client con una project root aperta può
 * pubblicare/ripubblicare un livello (`publishManifestEntries` in
 * EditorRoom.ts) — chi pubblica per ULTIMO per un dato `parentPath` è
 * quello che vince, stesso stile "ultimo che scrive vince" già accettato
 * per `commitTransform`. Deciso così per evitare la fragilità di un client
 * "sorgente di verità" che si disconnette (rischio esplicitamente segnalato
 * nel documento di continuazione per l'alternativa "primo client apre la
 * root = autorità").
 */
export class ManifestEntryState extends Schema {
  @type("string") parentPath = "";
  @type("string") name = "";
  @type("string") kind = "file";
}

export class EditorRoomState extends Schema {
  @type({ map: TransformState }) transforms = new MapSchema<TransformState>();
  @type({ map: ClientInfo }) clients = new MapSchema<ClientInfo>();
  @type({ map: "string" }) editingBy = new MapSchema<string>();
  @type({ map: GameObjectMetaState }) gameObjectMeta = new MapSchema<GameObjectMetaState>();
  @type({ map: ComponentState }) components = new MapSchema<ComponentState>();
  @type({ map: ManifestEntryState }) manifestEntries = new MapSchema<ManifestEntryState>();
}

/** Costruisce la chiave/percorso di una entry di manifest (Fase 10E) — stessa regola esatta di `joinProjectPath` in `projectTreeState.ts` lato editor. */
export function manifestEntryPath(parentPath: string, name: string): string {
  return parentPath === MANIFEST_ROOT_PATH ? name : `${parentPath}/${name}`;
}

/** Costruisce una nuova ManifestEntryState (Fase 10E, usato in `publishManifestEntries`). */
export function toManifestEntryState(parentPath: string, name: string, kind: "file" | "directory"): ManifestEntryState {
  const state = new ManifestEntryState();
  state.parentPath = parentPath;
  state.name = name;
  state.kind = kind;
  return state;
}

/** Costruisce la chiave composita usata da `EditorRoomState.components` (Fase 6D). Vedi JSDoc di `ComponentState` sopra. */
export function componentKey(gameObjectId: string, type: string): string {
  return `${gameObjectId}:${type}`;
}

/** Costruisce una nuova ComponentState da un ComponentData (Fase 6D, usato in hydrateScene/addComponent). */
export function toComponentState(gameObjectId: string, data: ComponentData): ComponentState {
  const state = new ComponentState();
  state.gameObjectId = gameObjectId;
  state.type = data.type;
  state.dataJson = JSON.stringify(data);
  return state;
}

/**
 * Aggiorna il `dataJson` di una ComponentState ESISTENTE (Fase 6D, usato da
 * `updateComponent`) — `gameObjectId`/`type` non cambiano mai su un update
 * (la chiave composita resta la stessa), solo i campi del componente.
 */
export function applyComponentDataToState(state: ComponentState, data: ComponentData): void {
  state.dataJson = JSON.stringify(data);
}

/** Costruisce una nuova TransformState da un TransformData (usato in hydrateScene). */
export function toTransformState(data: TransformData): TransformState {
  const state = new TransformState();
  applyTransformData(state, data);
  return state;
}

/** Costruisce una nuova GameObjectMetaState da kind+name (Fase 6C.2, usato in addGameObject). */
export function toGameObjectMetaState(kind: string, name: string): GameObjectMetaState {
  const state = new GameObjectMetaState();
  state.kind = kind;
  state.name = name;
  return state;
}

/**
 * Applica un TransformData a una TransformState ESISTENTE, mutando le
 * proprietà invece di sostituire l'istanza — è il pattern efficiente
 * raccomandato per Colyseus (ogni assegnazione aggiorna il ChangeTree della
 * singola proprietà, invece di forzare la re-serializzazione dell'intero
 * sotto-oggetto). Usato sia da `hydrateScene` sia da `commitTransform`.
 */
export function applyTransformData(state: TransformState, data: TransformData): void {
  state.position.x = data.position.x;
  state.position.y = data.position.y;
  state.position.z = data.position.z;
  state.rotation.x = data.rotation.x;
  state.rotation.y = data.rotation.y;
  state.rotation.z = data.rotation.z;
  state.rotation.w = data.rotation.w;
  state.scale.x = data.scale.x;
  state.scale.y = data.scale.y;
  state.scale.z = data.scale.z;
}
