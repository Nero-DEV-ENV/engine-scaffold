import { openDB, deleteDB, type IDBPDatabase } from "idb";
import type { SceneData } from "@engine/core";

/**
 * ScenePersistence — persistenza della scena dell'editor su IndexedDB
 * (Fase 5B), tramite `idb` (wrapper Promise-based sopra l'API IndexedDB
 * nativa a callback/eventi, verificato su npm: 8.0.3, zero dipendenze).
 *
 * Uno slot fisso (`CURRENT_SCENE_KEY`): il deliverable di questa fase è
 * "una scena sopravvive al reload", non una gestione multi-scena/multi-slot
 * — fuori scope finché non richiesto esplicitamente.
 *
 * Stato a livello di modulo (connessione DB cache-ata in `dbPromise`),
 * stesso stile già usato da `Scene.ts`/`Physics.ts` nel core per uno stato
 * singleton implicito senza dover esportare una classe — qui in più `idb`
 * gestisce già da sé l'apertura idempotente della connessione.
 */

const DB_NAME = "engine-editor";
const DB_VERSION = 1;
const SCENES_STORE = "scenes";
const CURRENT_SCENE_KEY = "current";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore(SCENES_STORE);
    },
  });
  return dbPromise;
}

/** Salva (sovrascrivendo) la scena corrente nello slot unico. */
export async function saveScene(data: SceneData): Promise<void> {
  const db = await getDB();
  await db.put(SCENES_STORE, data, CURRENT_SCENE_KEY);
}

/** Carica la scena salvata, o `null` se non è mai stata salvata nessuna scena. */
export async function loadScene(): Promise<SceneData | null> {
  const db = await getDB();
  const data = (await db.get(SCENES_STORE, CURRENT_SCENE_KEY)) as SceneData | undefined;
  return data ?? null;
}

/**
 * @internal — usato solo dai test per ripartire da uno stato pulito fra un
 * test e l'altro (stesso pattern di `_resetScene`/`_resetPhysics` nel core):
 * chiude la connessione cache-ata ed elimina il database, così ogni test
 * parte da IndexedDB vuoto invece di ereditare lo stato del test precedente
 * nello stesso processo Vitest.
 */
export async function _resetPersistenceForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME);
}
