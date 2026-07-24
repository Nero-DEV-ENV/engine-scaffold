import { Client, getStateCallbacks } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";
import type { TransformData } from "@engine/core";
import { serializeTransform, applyTransformData } from "@engine/core";
import { createExternalStore, sceneRootsStore, bumpTransformVersion } from "../store/editorStore.js";
import { flattenGameObjects } from "../scene/hierarchy.js";

/**
 * collabClient.ts — Fase 6B.client-1: connessione base a `editor_room`
 * (Colyseus) via WebSocket normale, sync `hydrateScene`/`commitTransform`.
 * Fase 6B.client-2 aggiunge: identità leggera (nome scelto dall'utente o
 * generato proceduralmente dal server, colore sempre assegnato dal
 * server), presence (striscia di chi è connesso, mostrata da Topbar.tsx),
 * lock ottimistico beginEdit/endEdit (letto da createEditorScene.ts per
 * disabilitare il gizmo su un oggetto lockato da un altro client e per
 * mostrarne l'highlight+etichetta). NIENTE WebRTC qui (arriva in Fase 6F).
 *
 * Shape strutturale minima di un TransformState ricevuto dal server: NON
 * importiamo la classe reale (`packages/server/src/schema/EditorRoomState.ts`,
 * decorata con @colyseus/schema) — verificato empiricamente in sandbox con
 * un server+client Colyseus reali che il protocollo wire di
 * @colyseus/schema si basa su reflection (handshake), quindi un'istanza
 * ricevuta espone già `.position.x` ecc. senza che il client importi la
 * classe server-side. Qui serve solo la FORMA dei dati letti, non la classe.
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

/**
 * Applica un TransformState ricevuto dal server (hydrate iniziale, o
 * commitTransform di un altro client) al GameObject locale corrispondente.
 * Ignora silenziosamente un gameObjectId non presente nella scena locale:
 * per 6B.client-1 non c'è ancora sync di aggiunta/rimozione GameObject
 * (Fase 6C) — un client con una scena diversa da un altro può quindi
 * ricevere un id che non ha localmente, e non c'è ancora un modo corretto
 * di gestirlo (crearlo al volo richiederebbe conoscerne nome/componenti,
 * fuori scope qui).
 */
function applyIncomingTransform(gameObjectId: string, transformState: TransformStateLike): void {
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
function buildHydratePayload(): { gameObjects: Array<{ id: string; transform: TransformData }> } {
  return {
    gameObjects: flattenGameObjects(sceneRootsStore.get()).map((go) => ({
      id: go.id,
      transform: serializeTransform(go),
    })),
  };
}

/**
 * Avvia la connessione a `editor_room`. No-op se già connessi/in
 * connessione. URL da `VITE_COLYSEUS_URL` con fallback a
 * `ws://localhost:2567` (punto 4 del documento di sessione — invariato
 * finché il tunnel di Fase 6F non è attivo).
 *
 * `displayName` (Fase 6B.client-2, opzionale): il nome scelto dall'utente
 * nel campo di Topbar, inviato come opzione di join. Se assente/vuoto il
 * server ricade su un nome generato proceduralmente — questa funzione non
 * ha bisogno di saperlo, si limita a inoltrare quello che riceve.
 */
export async function connect(displayName?: string): Promise<void> {
  const current = connectionStore.get().status;
  if (current === "connecting" || current === "connected") return;
  connectionStore.set({ status: "connecting" });

  const url = import.meta.env.VITE_COLYSEUS_URL ?? DEFAULT_COLYSEUS_URL;

  try {
    const client = new Client(url);
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

    room.onLeave(() => {
      activeRoom = null;
      detachAll();
      resetSessionStores();
      connectionStore.set({ status: "idle" });
    });

    room.onError((_code: number, message?: string) => {
      connectionStore.set({ status: "error", message: message ?? "Errore di connessione sconosciuto" });
    });

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
