import { Client, getStateCallbacks } from "@colyseus/sdk";
import type { Room, FetchFn } from "@colyseus/sdk";
import type { TransformData, ComponentData, ComponentTypeName } from "@engine/core";
import { serializeTransform, applyTransformData, Component, serializeComponent } from "@engine/core";
import { createExternalStore, sceneRootsStore, editorSceneHandleStore, bumpTransformVersion } from "../store/editorStore.js";
import { flattenGameObjects } from "../scene/hierarchy.js";
import type { ProjectEntry } from "./projectFolderClient.js";

/**
 * collabClient.ts — Fase 6B.client-1: connessione base a `editor_room`
 * (Colyseus) via WebSocket normale, sync `hydrateScene`/`commitTransform`.
 * Fase 6B.client-2 aggiunge: identità leggera (nome scelto dall'utente o
 * generato proceduralmente dal server, colore sempre assegnato dal
 * server), presence (striscia di chi è connesso, mostrata da Topbar.tsx),
 * lock ottimistico beginEdit/endEdit (letto da createEditorScene.ts per
 * disabilitare il gizmo su un oggetto lockato da un altro client e per
 * mostrarne l'highlight+etichetta).
 *
 * Fase 6F.3.d (punto aperto 3, "rapporto con flusso esistente" — decisione
 * utente: UNICA UI con scelta esplicita locale/LAN vs tunnel) aggiunge un
 * `transportOverride` OPZIONALE a `connect()`: quando presente, sostituisce
 * l'URL normale e inietta un `fetchFn` custom (quello tunnelato via WebRTC,
 * vedi webrtcTransport.ts/tunnelGuest.ts) nel costruttore `Client` di
 * @colyseus/sdk — verificato sui tipi reali della libreria che il
 * costruttore accetta `(settings?: string | EndpointSettings, options?:
 * ClientOptions)` con `ClientOptions.fetchFn?: FetchFn`. Il resto della
 * funzione (hydrate, sync transform/presence/lock, room.onLeave/onError)
 * resta IDENTICO indipendentemente dal transport: è la Room di
 * @colyseus/sdk a differire internamente (WebSocket reale vs
 * WebRTCTransport registrato in Connection.customTransports — vedi
 * webrtcTransport.ts), non il codice qui. Questo evita di duplicare
 * presence/lock/hydrate in un modulo parallelo per il guest-via-tunnel.
 *
 * Shape strutturale minima di un TransformState ricevuto dal server: NON
 * importiamo la classe reale (`packages/server/src/schema/EditorRoomState.ts`,
 * decorata con @colyseus/schema) — verificato empiricamente in sandbox con
 * un server+client Colyseus reali che il protocollo wire di
 * @colyseus/schema si basa su reflection (handshake), quindi un'istanza
 * ricevuta espone già `.position.x` ecc. senza che il client importi la
 * classe server-side. Qui serve solo la FORMA dei dati letti, non la classe.
 *
 * Fase 6C.2 aggiunge sync di aggiunta/rimozione GameObject: `transforms`
 * resta l'unica fonte di verità su "questo GameObject esiste nella scena
 * condivisa" (`transforms.onAdd`/`onRemove` guidano rispettivamente
 * creazione e rimozione locale, tramite `ensureGameObjectExists` sotto);
 * `gameObjectMeta` (kind+name) è un aiuto SOLO per la ricostruzione di un
 * oggetto che il client non possiede ancora — vedi il JSDoc di
 * `ensureGameObjectExists` per la verifica empirica sull'ordine di arrivo
 * fra le due MapSchema.
 */
interface TransformStateLike {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
}

/** Shape strutturale minima di un ClientInfo ricevuto dal server (stesso motivo di TransformStateLike sopra). */
export interface ClientInfoLike {
  name: string;
  color: string;
}

/** Le quattro primitive create/ricreabili da `EditorSceneHandle.addGameObject` (Fase 6C.1/6C.2). */
export type GameObjectKind = "empty" | "box" | "sphere" | "plane";

/** Shape strutturale minima di un GameObjectMeta ricevuto dal server (Fase 6C.2, stesso motivo di TransformStateLike sopra). */
export interface GameObjectMetaLike {
  kind: string;
  name: string;
}

/** Shape strutturale minima di un ComponentState ricevuto dal server (Fase 6D, stesso motivo di TransformStateLike sopra). */
export interface ComponentStateLike {
  gameObjectId: string;
  type: string;
  dataJson: string;
}

/** Shape strutturale minima di una ManifestEntryState ricevuta dal server (Fase 10E, stesso motivo di TransformStateLike sopra). */
export interface ManifestEntryLike {
  parentPath: string;
  name: string;
  kind: "file" | "directory";
}

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "error"; message: string };

/** Stato di connessione Colyseus, letto dalla UI (Topbar, Fase 6B.client-1) via `.useValue()`. */
export const connectionStore = createExternalStore<ConnectionState>({ status: "idle" });

/**
 * Presence: chi è connesso ora, keyed per sessionId — letto dalla Topbar
 * (striscia presence, Fase 6B.client-2). Nuova Map ad ogni cambiamento
 * (stesso stile immutabile di connectionStore) invece di una mutazione in
 * place, perché `createExternalStore.set` confronta con `Object.is` per
 * decidere se notificare i sottoscrittori.
 */
export const presenceStore = createExternalStore<ReadonlyMap<string, ClientInfoLike>>(new Map());

/**
 * Lock di editing in corso, keyed per gameObjectId → sessionId di chi lo
 * detiene — letto da createEditorScene.ts per disabilitare il gizmo su un
 * oggetto lockato da un ALTRO client (non dal client locale stesso, che
 * deve poter continuare a trascinare l'oggetto che ha appena lockato) e
 * per disegnarne l'highlight+etichetta.
 */
export const editingByStore = createExternalStore<ReadonlyMap<string, string>>(new Map());

/**
 * sessionId assegnato dal server al client locale per la connessione
 * corrente, o null se non connessi. Serve a distinguere "questo lock è mio"
 * da "questo lock è di un altro client" leggendo editingByStore.
 */
export const mySessionIdStore = createExternalStore<string | null>(null);

/**
 * Manifest sincronizzato della project folder (Fase 10E), raggruppato per
 * `parentPath` — stessa forma di `ProjectEntry[]` restituita da
 * `listProjectDirectory` (network/projectFolderClient.ts), così che
 * `panels/ProjectTree.tsx` possa popolare un livello dell'albero SENZA una
 * scansione locale, quando connessi alla stessa `editor_room` (vedi
 * `rebuildManifestGroup` sotto). Quando NON connessi, l'albero resta quello
 * di Fase 10B-10D (solo scansione locale via host-agent) — nessun cambio lì.
 * Nuova Map ad ogni cambiamento (stesso stile immutabile di
 * presenceStore/editingByStore sopra).
 */
export const manifestEntriesStore = createExternalStore<ReadonlyMap<string, ProjectEntry[]>>(new Map());

/**
 * Ricostruisce il gruppo di entry per `parentPath` filtrando l'INTERA
 * `room.state.manifestEntries` (non un delta incrementale) — costo
 * trascurabile per lo scope v1 (solo glTF/GLB + PNG/JPG, niente scansione
 * ricorsiva eager, vedi decisione di Fase 10E). Stesso ordinamento
 * cartelle-poi-file/alfabetico già usato da `listDirectory` lato host-agent,
 * per rendere il risultato indistinguibile da una scansione locale agli
 * occhi di `projectTreeState.ts`.
 */
function rebuildManifestGroup(parentPath: string): void {
  if (!activeRoom) return;
  const entries: ProjectEntry[] = [];
  (activeRoom.state.manifestEntries as Map<string, ManifestEntryLike>).forEach((entry) => {
    if (entry.parentPath === parentPath) {
      entries.push({ name: entry.name, kind: entry.kind });
    }
  });
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const next = new Map(manifestEntriesStore.get());
  next.set(parentPath, entries);
  manifestEntriesStore.set(next);
}

const DEFAULT_COLYSEUS_URL = "ws://localhost:2567";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vedi commento su TransformStateLike sopra: il tipo reale di Room/state non è condiviso col client, il confine è strutturale.
let activeRoom: Room<any, any> | null = null;
let detachFns: Array<() => void> = [];

function detachAll(): void {
  for (const detach of detachFns) detach();
  detachFns = [];
}

function resetSessionStores(): void {
  presenceStore.set(new Map());
  editingByStore.set(new Map());
  mySessionIdStore.set(null);
  manifestEntriesStore.set(new Map());
}

/**
 * Risolve un `gameObjectId` (chiave della MapSchema server-side) nel
 * GameObject locale corrispondente, ricamminando `sceneRootsStore` OGNI
 * volta (non una mappa cache costruita una tantum al connect): resta
 * corretto anche dopo un Load (Topbar) che sostituisce l'intera scena con
 * nuove istanze GameObject aventi gli stessi id salvati.
 */
function resolveGameObjectById(gameObjectId: string) {
  return flattenGameObjects(sceneRootsStore.get()).find((go) => go.id === gameObjectId) ?? null;
}

const GAME_OBJECT_KINDS = new Set<GameObjectKind>(["empty", "box", "sphere", "plane"]);

function isGameObjectKind(value: string): value is GameObjectKind {
  return GAME_OBJECT_KINDS.has(value as GameObjectKind);
}

const COMPONENT_TYPE_NAMES = new Set<ComponentTypeName>([
  "MeshRenderer",
  "Light",
  "RigidBody",
  "BoxCollider",
  "SphereCollider",
]);

function isComponentTypeName(value: string): value is ComponentTypeName {
  return COMPONENT_TYPE_NAMES.has(value as ComponentTypeName);
}

/**
 * Ricrea localmente (Fase 6C.2) il GameObject `gameObjectId` se non esiste
 * già in locale, leggendo `gameObjectMeta`/`transforms` DIRETTAMENTE da
 * `room.state` (senza passare da `$()`, che serve solo a REGISTRARE
 * callback, non a leggere il valore corrente). Chiamata da ENTRAMBI
 * `transforms.onAdd` e `gameObjectMeta.onAdd` (che possono arrivare in
 * qualunque ordine relativo nello stesso patch di rete — vedi sotto):
 * essendo idempotente (esce subito se il GameObject esiste già, incluso il
 * caso in cui sia stato appena creato in locale in modo ottimistico dal
 * client stesso), il risultato non dipende da quale dei due onAdd scatta
 * per primo.
 *
 * Lettura diretta di `room.state.transforms`/`room.state.gameObjectMeta`
 * VERIFICATA empiricamente con un client @colyseus/sdk reale (non solo
 * assunta): subito dopo la connessione questi campi sono `undefined` per
 * una breve finestra (il primo sync completo dello stato non è istantaneo),
 * MA una volta che un QUALUNQUE onAdd di QUALUNQUE mappa di `room.state` è
 * scattato almeno una volta, l'intero `room.state` — inclusi i campi
 * "fratelli" come `transforms` quando si è dentro `gameObjectMeta.onAdd`,
 * o viceversa — è già popolato (lo stato arriva come un unico sync
 * coerente, non campo per campo). Poiché questa funzione è chiamata SOLO
 * da dentro un callback onAdd (mai subito dopo connect()), la lettura è
 * sicura per costruzione.
 *
 * Se `gameObjectId` non ha un'entry in `gameObjectMeta`, l'oggetto è
 * pre-esistente (hydratato all'avvio, già presente in ogni client dalla
 * scena iniziale) — nessuna ricreazione necessaria, nessuna azione.
 */
function ensureGameObjectExists(gameObjectId: string): void {
  if (resolveGameObjectById(gameObjectId)) return;
  if (!activeRoom) return;
  const meta = activeRoom.state.gameObjectMeta.get(gameObjectId) as GameObjectMetaLike | undefined;
  if (!meta || !isGameObjectKind(meta.kind)) return;
  const handle = editorSceneHandleStore.get();
  if (!handle) return;
  const transformState = activeRoom.state.transforms.get(gameObjectId) as TransformStateLike | undefined;
  // `exactOptionalPropertyTypes: true` (tsconfig.base.json) rifiuta
  // `transform: undefined` esplicito — la chiave va omessa del tutto
  // quando non c'è un TransformState, non passata con valore undefined.
  const addOptions: { id: string; select: false; broadcast: false; transform?: TransformData } = transformState
    ? {
        id: gameObjectId,
        select: false,
        broadcast: false,
        transform: {
          position: { x: transformState.position.x, y: transformState.position.y, z: transformState.position.z },
          rotation: {
            x: transformState.rotation.x,
            y: transformState.rotation.y,
            z: transformState.rotation.z,
            w: transformState.rotation.w,
          },
          scale: { x: transformState.scale.x, y: transformState.scale.y, z: transformState.scale.z },
        },
      }
    : { id: gameObjectId, select: false, broadcast: false };
  handle.addGameObject(meta.kind, meta.name, addOptions);
  // Fase 6D: applica SUBITO eventuali componenti già noti per questo
  // gameObjectId al momento della ricostruzione — copre il caso in cui
  // `components.onAdd` sia scattato PRIMA che questo GameObject esistesse
  // in locale (ordine relativo fra le mappe non garantito, stesso discorso
  // già documentato sopra per gameObjectMeta/transforms). Vedi JSDoc di
  // `ensureComponentApplied` sotto per il perché è un UPSERT e non un
  // semplice addComponent.
  if (activeRoom) {
    (activeRoom.state.components as Map<string, ComponentStateLike>).forEach((componentState) => {
      if (componentState.gameObjectId === gameObjectId) {
        ensureComponentApplied(componentState.gameObjectId, componentState.type, componentState.dataJson);
      }
    });
  }
}

/**
 * Applica un ComponentState ricevuto dal server (Fase 6D: hydrate iniziale,
 * o addComponent/updateComponent proprio o di un ALTRO client) al
 * GameObject locale corrispondente. UPSERT deliberato (non un semplice
 * `addComponent`): un GameObject appena ricostruito da
 * `ensureGameObjectExists` per un kind box/sphere/plane porta GIÀ un
 * MeshRenderer di default (vedi `shapeForKind`/`addGameObject` in
 * createEditorScene.ts) — se questa funzione chiamasse
 * `handle.addComponent` incondizionatamente per quel MeshRenderer
 * sincronizzato, `GameObject.addComponent` lancerebbe (due componenti
 * dello stesso tipo sullo stesso GameObject non sono ammessi — vedi
 * core/GameObject.ts). L'esistenza è verificata via `serializeComponent`
 * (non una mappa tipo→classe, che duplicherebbe lo switch già esaustivo in
 * SceneSerializer.ts): confronta il `type` di ogni componente già presente
 * con quello ricevuto.
 *
 * Ignora silenziosamente (no-op, da ritentare più tardi) se il GameObject
 * non esiste ancora in locale: succede quando questo callback scatta PRIMA
 * che `transforms.onAdd`/`gameObjectMeta.onAdd` abbiano ricreato il
 * GameObject per un oggetto aggiunto a runtime da un altro client — coperto
 * dal secondo tentativo esplicito dentro `ensureGameObjectExists` sopra,
 * subito dopo aver creato il GameObject.
 */
function ensureComponentApplied(gameObjectId: string, type: string, dataJson: string): void {
  if (!isComponentTypeName(type)) return; // difesa: il server valida già `type` prima di scriverlo, non dovrebbe mai accadere
  const go = resolveGameObjectById(gameObjectId);
  if (!go) return;
  const handle = editorSceneHandleStore.get();
  if (!handle) return;
  let data: ComponentData;
  try {
    data = JSON.parse(dataJson) as ComponentData;
  } catch {
    return; // dataJson malformato: non dovrebbe mai accadere (scritto solo da JSON.stringify server-side), difesa
  }
  const alreadyPresent = go.getComponents(Component).some((c) => serializeComponent(c)?.type === type);
  if (alreadyPresent) {
    handle.updateComponent(go, data, { broadcast: false });
  } else {
    handle.addComponent(go, data, { broadcast: false });
  }
}

/**
 * Applica un TransformState ricevuto dal server (hydrate iniziale, o
 * commitTransform di un altro client) al GameObject locale corrispondente.
 * Ignora silenziosamente un gameObjectId non presente nella scena locale
 * DOPO aver tentato `ensureGameObjectExists` (Fase 6C.2) — un gameObjectId
 * ancora sconosciuto a quel punto è un limite residuo noto (es. scene
 * locali divergenti in modi che 6C.2 non copre) e resta ignorato come
 * prima.
 */
function applyIncomingTransform(gameObjectId: string, transformState: TransformStateLike): void {
  ensureGameObjectExists(gameObjectId);
  const go = resolveGameObjectById(gameObjectId);
  if (!go) return;
  const data: TransformData = {
    position: { x: transformState.position.x, y: transformState.position.y, z: transformState.position.z },
    rotation: {
      x: transformState.rotation.x,
      y: transformState.rotation.y,
      z: transformState.rotation.z,
      w: transformState.rotation.w,
    },
    scale: { x: transformState.scale.x, y: transformState.scale.y, z: transformState.scale.z },
  };
  applyTransformData(go, data);
  // Bump incondizionato: se il GameObject aggiornato è quello attualmente
  // selezionato, l'Inspector si ridisegna con i valori remoti aggiornati
  // (stesso contatore già bumpato dal drag locale del gizmo — vedi
  // createEditorScene.ts). Se non è quello selezionato, il bump è
  // innocuo: l'Inspector legge comunque `selected.transform` da capo.
  bumpTransformVersion();
}

/** Costruisce il payload `hydrateScene` dalla scena locale corrente (un entry per GameObject, non un albero). */
function buildHydratePayload(): {
  gameObjects: Array<{ id: string; transform: TransformData; components: ComponentData[] }>;
} {
  return {
    gameObjects: flattenGameObjects(sceneRootsStore.get()).map((go) => ({
      id: go.id,
      transform: serializeTransform(go),
      components: go
        .getComponents(Component)
        .map(serializeComponent)
        .filter((data): data is ComponentData => data !== null),
    })),
  };
}

/**
 * Override del transport per la connessione guest-via-tunnel (Fase
 * 6F.3.d): `url` è un valore fittizio richiesto dal costruttore `Client`
 * (la vera richiesta di matchmake passa dal `fetchFn` tunnelato, non da
 * una vera connessione di rete a `url` — stesso pattern già documentato
 * in webrtcTransport.ts, `"ws://tunnel.invalid"`), `fetchFn` è quello
 * costruito da `createTunnelFetchFn()` in webrtcTransport.ts. IMPORTANTE:
 * il chiamante deve aver già invocato `registerWebRTCTransport(channels)`
 * PRIMA di passare questo override a `connect()` (registra la classe
 * `WebRTCTransport` in `Connection.customTransports.webrtc`, letta da
 * `Room.connect()` internamente in base al `protocol` che il fetchFn
 * inietta nella risposta — vedi webrtcTransport.ts per i dettagli).
 */
export interface TunnelTransportOverride {
  url: string;
  fetchFn: FetchFn;
}

/**
 * Avvia la connessione a `editor_room`. No-op se già connessi/in
 * connessione.
 *
 * Senza `transportOverride`: URL da `VITE_COLYSEUS_URL` con fallback a
 * `ws://localhost:2567` (connessione locale/LAN diretta, comportamento
 * invariato da Fase 6B).
 *
 * Con `transportOverride` (Fase 6F.3.d, guest-via-tunnel): usa l'URL e il
 * `fetchFn` forniti invece del normale URL locale/LAN — vedi JSDoc di
 * `TunnelTransportOverride` sopra per i prerequisiti. Tutto il resto della
 * funzione (hydrate, sync, presence, lock, error handling) resta
 * invariato: è la Room di @colyseus/sdk a instradare i messaggi sul
 * transport giusto internamente.
 *
 * `displayName` (Fase 6B.client-2, opzionale): il nome scelto dall'utente
 * nel campo di Topbar, inviato come opzione di join. Se assente/vuoto il
 * server ricade su un nome generato proceduralmente — questa funzione non
 * ha bisogno di saperlo, si limita a inoltrare quello che riceve.
 */
export async function connect(displayName?: string, transportOverride?: TunnelTransportOverride): Promise<void> {
  const current = connectionStore.get().status;
  if (current === "connecting" || current === "connected") return;
  connectionStore.set({ status: "connecting" });

  const url = transportOverride?.url ?? import.meta.env.VITE_COLYSEUS_URL ?? DEFAULT_COLYSEUS_URL;

  try {
    const client = new Client(url, transportOverride ? { fetchFn: transportOverride.fetchFn } : undefined);
    const room = await client.joinOrCreate("editor_room", displayName ? { displayName } : {});
    activeRoom = room;
    mySessionIdStore.set(room.sessionId);

    const $ = getStateCallbacks(room);
    // Non-null assertion su `.transforms`/`.clients`/`.editingBy`: il tipo
    // di `room.state` qui non è condiviso col client (nessuna classe
    // EditorRoomState importata, vedi commento su TransformStateLike in
    // cima al file) — TypeScript non può sapere che questi campi esistono
    // sempre, ma il protocollo server-side (EditorRoom.onCreate →
    // this.setState(new EditorRoomState())) lo garantisce per costruzione
    // ad ogni Room creata.
    const detachTransformsOnAdd = $(room.state).transforms!.onAdd(
      (transformState: TransformStateLike, gameObjectId: string) => {
        applyIncomingTransform(gameObjectId, transformState);
        // I tre onChange nested (non uno solo su transformState: verificato
        // empiricamente in sandbox che un onChange sul genitore NON si
        // attiva per una mutazione di una sua proprietà Schema annidata,
        // solo per la riassegnazione della proprietà stessa — qui invece
        // muta sempre in place x/y/z, vedi applyTransformData server-side).
        $(transformState.position).onChange(() => applyIncomingTransform(gameObjectId, transformState));
        $(transformState.rotation).onChange(() => applyIncomingTransform(gameObjectId, transformState));
        $(transformState.scale).onChange(() => applyIncomingTransform(gameObjectId, transformState));
      },
      true,
    );
    detachFns.push(detachTransformsOnAdd);

    // Rimozione (Fase 6C.2): `transforms` è l'unica fonte di verità su
    // "questo GameObject esiste nella scena condivisa" (vedi
    // EditorRoomState.ts), quindi `transforms.onRemove` è il trigger
    // corretto per la rimozione locale — copre SIA gli oggetti pre-esistenti
    // (hydratati) SIA quelli aggiunti a runtime, senza dover distinguere i
    // due casi qui. Ignora silenziosamente un id non trovato in locale
    // (stesso stile di applyIncomingTransform).
    const detachTransformsOnRemove = $(room.state).transforms!.onRemove((_transformState: TransformStateLike, gameObjectId: string) => {
      const handle = editorSceneHandleStore.get();
      const go = resolveGameObjectById(gameObjectId);
      if (!handle || !go) return;
      handle.removeGameObject(go, { broadcast: false });
    });
    detachFns.push(detachTransformsOnRemove);

    // gameObjectMeta (Fase 6C.2): NON è il trigger di creazione principale
    // (quello resta `transforms.onAdd` sopra, tramite applyIncomingTransform
    // → ensureGameObjectExists) — serve solo a coprire il caso in cui
    // `gameObjectMeta.onAdd` scatti PRIMA di `transforms.onAdd` per lo
    // stesso id (l'ordine relativo fra le due mappe non è garantito, vedi
    // JSDoc di ensureGameObjectExists sopra): chiamando la stessa funzione
    // idempotente da entrambi i punti, il risultato non dipende da quale
    // dei due arriva per primo. Nessun `onRemove` qui: la rimozione è
    // gestita una sola volta, da `transforms.onRemove` sopra.
    const detachGameObjectMetaOnAdd = $(room.state).gameObjectMeta!.onAdd(
      (_meta: GameObjectMetaLike, gameObjectId: string) => {
        ensureGameObjectExists(gameObjectId);
      },
      true,
    );
    detachFns.push(detachGameObjectMetaOnAdd);

    // components (Fase 6D): onAdd copre sia l'hydrate iniziale
    // (immediate:true, come le altre mappe sopra) sia un componente
    // aggiunto in seguito da QUALUNQUE client (compreso quello locale
    // stesso, per cui `ensureComponentApplied` è un no-op perché il
    // componente esiste già — vedi JSDoc della funzione). L'onChange
    // nested su `componentState` (non su un valore primitivo, a differenza
    // di `editingBy` sotto: `ComponentState` è a sua volta uno Schema, con
    // lo stesso motivo già verificato empiricamente per `transformState`
    // sopra) cattura un `updateComponent` successivo, riassegnando
    // `dataJson` — un campo primitivo diretto sull'istanza, non annidato,
    // ma comunque bisognoso di un onChange esplicito e non catturato da
    // `onAdd` (che scatta solo alla creazione dell'entry nella mappa).
    const detachComponentsOnAdd = $(room.state).components!.onAdd((componentState: ComponentStateLike, key: string) => {
      ensureComponentApplied(componentState.gameObjectId, componentState.type, componentState.dataJson);
      $(componentState).onChange(() => {
        ensureComponentApplied(componentState.gameObjectId, componentState.type, componentState.dataJson);
      });
      void key; // la chiave composita non serve qui: gameObjectId/type sono già campi propri di componentState
    }, true);
    detachFns.push(detachComponentsOnAdd);

    const detachComponentsOnRemove = $(room.state).components!.onRemove((componentState: ComponentStateLike) => {
      if (!isComponentTypeName(componentState.type)) return;
      const handle = editorSceneHandleStore.get();
      const go = resolveGameObjectById(componentState.gameObjectId);
      if (!handle || !go) return;
      handle.removeComponent(go, componentState.type, { broadcast: false });
    });
    detachFns.push(detachComponentsOnRemove);

    // Presence (Fase 6B.client-2): a differenza di `transforms`, i valori
    // di `clients` (ClientInfo: name+color) non vengono mai mutati in place
    // dopo l'assegnazione al join — non serve quindi alcun onChange nested
    // come sopra, solo onAdd (immediate:true, per ricevere subito i client
    // già connessi quando ci si unisce dopo) e onRemove.
    const detachClientsOnAdd = $(room.state).clients!.onAdd((info: ClientInfoLike, sessionId: string) => {
      const next = new Map(presenceStore.get());
      next.set(sessionId, { name: info.name, color: info.color });
      presenceStore.set(next);
    }, true);
    detachFns.push(detachClientsOnAdd);

    const detachClientsOnRemove = $(room.state).clients!.onRemove((_info: ClientInfoLike, sessionId: string) => {
      const next = new Map(presenceStore.get());
      next.delete(sessionId);
      presenceStore.set(next);
    });
    detachFns.push(detachClientsOnRemove);

    // Lock ottimistico (Fase 6B.client-2): `editingBy` ha valori stringa
    // primitivi (sessionId), non Schema annidati — onAdd/onRemove diretti
    // sulla mappa bastano, nessuna sottigliezza di onChange su
    // sotto-istanze (a differenza di `transforms` sopra, vedi anche la nota
    // equivalente in EditorRoomState.ts lato server).
    const detachEditingByOnAdd = $(room.state).editingBy!.onAdd((sessionId: string, gameObjectId: string) => {
      const next = new Map(editingByStore.get());
      next.set(gameObjectId, sessionId);
      editingByStore.set(next);
    }, true);
    detachFns.push(detachEditingByOnAdd);

    const detachEditingByOnRemove = $(room.state).editingBy!.onRemove((_sessionId: string, gameObjectId: string) => {
      const next = new Map(editingByStore.get());
      next.delete(gameObjectId);
      editingByStore.set(next);
    });
    detachFns.push(detachEditingByOnRemove);

    // Manifest della project folder (Fase 10E): onAdd copre sia l'hydrate
    // iniziale (immediate:true, come le altre mappe sopra) sia una entry
    // pubblicata in seguito da QUALUNQUE client (compreso quello locale
    // stesso, subito dopo un `sendPublishManifestEntries` — vedi sotto).
    // L'onChange nested su `entryState` cattura la transizione cartella→file
    // gestita server-side (stesso motivo già verificato empiricamente per
    // `componentState`/`transformState` sopra: `kind` è un campo primitivo
    // diretto, ma comunque non catturato da `onAdd`, che scatta solo alla
    // creazione dell'entry nella mappa).
    const detachManifestOnAdd = $(room.state).manifestEntries!.onAdd((entryState: ManifestEntryLike) => {
      rebuildManifestGroup(entryState.parentPath);
      $(entryState).onChange(() => rebuildManifestGroup(entryState.parentPath));
    }, true);
    detachFns.push(detachManifestOnAdd);

    const detachManifestOnRemove = $(room.state).manifestEntries!.onRemove((entryState: ManifestEntryLike) => {
      rebuildManifestGroup(entryState.parentPath);
    });
    detachFns.push(detachManifestOnRemove);

    room.onLeave(() => {
      activeRoom = null;
      detachAll();
      resetSessionStores();
      connectionStore.set({ status: "idle" });
    });

    room.onError((_code: number, message?: string) => {
      connectionStore.set({ status: "error", message: message ?? "Errore di connessione sconosciuto" });
    });

    // gameObjectsRemoved (Fase 6C.2, fix): risposta MIRATA del server al
    // proprio hydrateScene (vedi JSDoc del messaggio in
    // packages/server/src/messages.ts) — elenca gli id che questo client ha
    // provato a hydratare ma che il server ha scartato perché già rimossi
    // definitivamente da qualcun altro PRIMA che questo client si
    // connettesse. Senza questo handler, la copia locale (bootstrap
    // hardcoded, indipendente dalla rete) di quell'oggetto resterebbe
    // visibile per sempre, perché non c'è mai stata una transizione
    // presente→assente da osservare dopo la connessione (unico caso che
    // `transforms.onRemove` sa gestire).
    const detachGameObjectsRemoved = room.onMessage("gameObjectsRemoved", (payload: { gameObjectIds: string[] }) => {
      const handle = editorSceneHandleStore.get();
      if (!handle) return;
      for (const gameObjectId of payload.gameObjectIds) {
        const go = resolveGameObjectById(gameObjectId);
        if (go) {
          handle.removeGameObject(go, { broadcast: false });
        }
      }
    });
    detachFns.push(detachGameObjectsRemoved);

    // componentsRemoved (Fase 6D, stesso fix di gameObjectsRemoved sopra,
    // stesso motivo esatto): elenca le chiavi composite (`gameObjectId:type`)
    // dei componenti che questo client ha provato a hydratare ma che il
    // server ha scartato perché già rimossi definitivamente da qualcun
    // altro PRIMA che questo client si connettesse.
    const detachComponentsRemoved = room.onMessage("componentsRemoved", (payload: { componentKeys: string[] }) => {
      const handle = editorSceneHandleStore.get();
      if (!handle) return;
      for (const key of payload.componentKeys) {
        const separatorIndex = key.lastIndexOf(":");
        if (separatorIndex < 0) continue;
        const gameObjectId = key.slice(0, separatorIndex);
        const type = key.slice(separatorIndex + 1);
        if (!isComponentTypeName(type)) continue;
        const go = resolveGameObjectById(gameObjectId);
        if (go) {
          handle.removeComponent(go, type, { broadcast: false });
        }
      }
    });
    detachFns.push(detachComponentsRemoved);

    room.send("hydrateScene", buildHydratePayload());
    connectionStore.set({ status: "connected" });
  } catch (error) {
    activeRoom = null;
    detachAll();
    resetSessionStores();
    connectionStore.set({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Abbandona la Room corrente, se connessi. No-op altrimenti. */
export async function disconnect(): Promise<void> {
  detachAll();
  const room = activeRoom;
  activeRoom = null;
  resetSessionStores();
  if (room) {
    await room.leave();
  }
  connectionStore.set({ status: "idle" });
}

/**
 * Invia un commitTransform al server — no-op se non connessi (l'editor
 * deve restare identico a oggi quando nessuna sessione è attiva). Da
 * chiamare dall'hook `dragging-changed` esistente in createEditorScene.ts,
 * a `event.value === false` (stesso punto che già disabilita/riabilita
 * cameraController).
 */
export function sendTransformCommit(gameObjectId: string, transform: TransformData): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("commitTransform", { gameObjectId, transform });
}

/**
 * Invia un addGameObject al server (Fase 6C.2) — no-op se non connessi.
 * Da chiamare da `EditorSceneHandle.addGameObject` (createEditorScene.ts)
 * SUBITO dopo la creazione locale ottimistica, con `broadcast: true`
 * (default) — mai per la ricostruzione remota di un oggetto già arrivato
 * dal server (quella chiamata usa `broadcast: false`).
 *
 * `components` (Fase 6D): i componenti CORRENTI del GameObject appena
 * creato localmente (es. il MeshRenderer di default di Cube/Sphere/Plane)
 * — vedi JSDoc di `AddGameObjectMessage.components` in messages.ts
 * (server) sul perché sono inviati nello STESSO messaggio invece di un
 * `addComponent` separato subito dopo.
 */
export function sendAddGameObject(
  id: string,
  kind: GameObjectKind,
  name: string,
  transform: TransformData,
  components: ComponentData[],
): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("addGameObject", { id, kind, name, transform, components });
}

/**
 * Invia un removeGameObject al server (Fase 6C.2) — no-op se non connessi.
 * Stesso discorso di `sendAddGameObject` sopra per `broadcast`.
 */
export function sendRemoveGameObject(gameObjectId: string): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("removeGameObject", { gameObjectId });
}

/**
 * Invia un addComponent al server (Fase 6D) — no-op se non connessi. Da
 * chiamare da `EditorSceneHandle.addComponent` (createEditorScene.ts)
 * SUBITO dopo la creazione locale ottimistica, con `broadcast: true`
 * (default) — mai per un componente già arrivato dal server (quella
 * chiamata usa `broadcast: false`, vedi `ensureComponentApplied` sopra).
 */
export function sendAddComponent(gameObjectId: string, component: ComponentData): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("addComponent", { gameObjectId, component });
}

/** Invia un removeComponent al server (Fase 6D) — no-op se non connessi. Stesso discorso di `sendAddComponent` per `broadcast`. */
export function sendRemoveComponent(gameObjectId: string, type: ComponentTypeName): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("removeComponent", { gameObjectId, type });
}

/** Invia un updateComponent al server (Fase 6D) — no-op se non connessi. Stesso discorso di `sendAddComponent` per `broadcast`. */
export function sendUpdateComponent(gameObjectId: string, component: ComponentData): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("updateComponent", { gameObjectId, component });
}

/**
 * Invia publishManifestEntries al server (Fase 10E) — no-op se non
 * connessi. Da chiamare da `ProjectTree.tsx` subito dopo un
 * `listProjectDirectory` riuscito (locale), per contribuire quel livello al
 * manifest condiviso — qualunque client con una project root aperta può
 * farlo, nessuna autorità unica (punto 2 del documento di continuazione,
 * confermato dall'utente).
 */
export function sendPublishManifestEntries(parentPath: string, entries: ProjectEntry[]): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("publishManifestEntries", { parentPath, entries });
}

/**
 * Invia un beginEdit al server (Fase 6B.client-2) — da chiamare dallo
 * stesso hook `dragging-changed`, a `event.value === true` (inizio drag).
 * No-op se non connessi.
 */
export function sendBeginEdit(gameObjectId: string): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("beginEdit", { gameObjectId });
}

/**
 * Invia un endEdit al server (Fase 6B.client-2) — da chiamare dallo stesso
 * hook `dragging-changed`, a `event.value === false` (fine drag), insieme
 * a `sendTransformCommit`. No-op se non connessi.
 */
export function sendEndEdit(gameObjectId: string): void {
  if (!activeRoom || connectionStore.get().status !== "connected") return;
  activeRoom.send("endEdit", { gameObjectId });
}
