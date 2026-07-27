import { openDB, deleteDB, type IDBPDatabase } from "idb";

/**
 * AssetPersistence — persistenza degli asset binari importati (Fase 7:
 * modelli GLTF/GLB, texture) su IndexedDB, tramite `idb` — stesso wrapper
 * già usato da ScenePersistence.ts.
 *
 * Database SEPARATO da `ScenePersistence.ts` (non un nuovo object store
 * nello stesso `engine-editor`, decisione confermata con l'utente — punto
 * aperto 2): due moduli che aprissero lo stesso nome di database con
 * `DB_VERSION` gestiti indipendentemente rischierebbero un conflitto di
 * versione/connessione bloccata se mai uno dei due venisse alzato senza
 * l'altro. Un database dedicato tiene i due moduli completamente
 * disaccoppiati, al costo di una seconda connessione IndexedDB aperta in
 * parallelo — trascurabile, `idb` la cache-a come già fa ScenePersistence.
 *
 * Ogni asset è salvato come `data: ArrayBuffer` (non `Blob`): IndexedDB nativo
 * supporta Blob nei browser moderni, ma `fake-indexeddb` (usato nei test,
 * vedi AssetPersistence.test.ts) e Node in generale hanno un supporto Blob
 * meno maturo/uniforme — un ArrayBuffer è dato puro, senza ambiguità fra
 * ambiente Node/browser, e un `Blob`/oggetto URL si ricostruisce da esso al
 * bordo (vedi `getAssetObjectURL` in ../assets/assetsController.ts) solo
 * quando davvero serve un URL per GLTFLoader.
 */

export type AssetKind = "model-gltf" | "texture";

/** Record completo, incluso il payload binario — usato solo per scrivere/leggere il singolo asset (mai per l'elenco, vedi AssetMeta sotto). */
export interface AssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
  data: ArrayBuffer;
}

/** Solo i metadati, SENZA il payload binario — è quanto basta al pannello Assets per elencare gli asset importati, senza tenere in memoria ogni blob. */
export interface AssetMeta {
  id: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
}

const DB_NAME = "engine-editor-assets";
const DB_VERSION = 1;
const ASSETS_STORE = "assets";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore(ASSETS_STORE);
    },
  });
  return dbPromise;
}

/** Salva (o sovrascrive, se `record.id` esiste già) un asset. */
export async function saveAsset(record: AssetRecord): Promise<void> {
  const db = await getDB();
  await db.put(ASSETS_STORE, record, record.id);
}

/** Carica il record completo (payload incluso) di un asset dato il suo id, o `null` se non esiste/è stato rimosso. */
export async function loadAsset(id: string): Promise<AssetRecord | null> {
  const db = await getDB();
  const data = (await db.get(ASSETS_STORE, id)) as AssetRecord | undefined;
  return data ?? null;
}

/** Elenca i metadati di tutti gli asset presenti, senza caricarne il payload binario in memoria. */
export async function listAssets(): Promise<AssetMeta[]> {
  const db = await getDB();
  const all = (await db.getAll(ASSETS_STORE)) as AssetRecord[];
  return all.map(({ id, name, kind, mimeType }) => ({ id, name, kind, mimeType }));
}

/** Rimuove un asset. No-op silenzioso se `id` non esiste (stesso stile già usato da `removeGameObject`/`removeComponent` in createEditorScene.ts per un intent non più valido). */
export async function deleteAsset(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(ASSETS_STORE, id);
}

/**
 * @internal — usato solo dai test per ripartire da uno stato pulito fra un
 * test e l'altro, stesso pattern di `_resetPersistenceForTests` in
 * ScenePersistence.ts.
 */
export async function _resetAssetPersistenceForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME);
}
