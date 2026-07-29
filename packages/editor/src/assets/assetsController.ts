import { saveAsset, loadAsset, listAssets, deleteAsset } from "../persistence/AssetPersistence.js";
import type { AssetKind, AssetMeta } from "../persistence/AssetPersistence.js";
import { assetsStore } from "../store/editorStore.js";
import { fetchProjectFile } from "../network/projectFolderClient.js";

/**
 * assetsController.ts — orchestrazione fra il file picker del browser
 * (File API), la persistenza IndexedDB (AssetPersistence.ts) e
 * `assetsStore` (React). Nessuna dipendenza da three.js/@engine/core qui:
 * la ricostruzione della gerarchia GLTF (attachGLTF) resta responsabilità
 * di createEditorScene.ts, che ha già in mano scene/GameObject — questo
 * modulo si occupa solo del ciclo di vita del BLOB (import/elenco/
 * rimozione/risoluzione a object URL), stesso confine già tracciato da
 * ScenePersistence.ts (dato) vs createEditorScene.ts (runtime three.js).
 *
 * Fase 7 — formati supportati (punto aperto 1, confermato con l'utente):
 * solo glTF/GLB per modelli e PNG/JPG per texture. OBJ/FBX arriveranno
 * solo quando le fasi che li richiedono davvero (13/14) saranno affrontate.
 */

const MODEL_EXTENSIONS = [".gltf", ".glb"];
const TEXTURE_MIME_PREFIX = "image/";
/** MIME di fallback per un file .gltf/.glb: alcuni browser/OS non popolano `File.type` per queste estensioni (verificato: nessun tipo MIME "ufficiale" registrato universalmente per .gltf in tutti i sistemi). */
const DEFAULT_MODEL_MIME = "model/gltf-binary";

/**
 * Determina il tipo di un `File` importato dal formato (estensione per i
 * modelli, MIME per le texture — `File.type` per un .gltf/.glb è spesso
 * vuoto o inconsistente a seconda del sistema operativo, mentre per le
 * immagini il browser lo popola in modo affidabile). Restituisce `null`
 * per qualunque formato non supportato in questa fase (punto aperto 1).
 */
export function detectAssetKind(file: File): AssetKind | null {
  const lowerName = file.name.toLowerCase();
  if (MODEL_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) return "model-gltf";
  if (file.type.startsWith(TEXTURE_MIME_PREFIX)) return "texture";
  return null;
}

/** Ricarica `assetsStore` dall'elenco corrente in IndexedDB — chiamata dopo ogni import/rimozione, e va invocata anche al mount di AssetsPanel.tsx per popolarlo la prima volta. */
export async function refreshAssets(): Promise<void> {
  assetsStore.set(await listAssets());
}

/**
 * Importa un `File` scelto dall'utente (drag&drop o file picker):
 * rileva il tipo, legge il payload binario e lo salva in IndexedDB con un
 * nuovo id generato qui. Restituisce `null` (senza scrivere nulla) se il
 * formato non è fra quelli supportati in questa fase — il chiamante
 * (AssetsPanel.tsx) mostra un messaggio d'errore in quel caso, stesso
 * stile "richiesta ignorata" già usato altrove nell'editor per un intent
 * non valido (es. `removeGameObject` su un id sconosciuto).
 */
export async function importAssetFile(file: File): Promise<AssetMeta | null> {
  const kind = detectAssetKind(file);
  if (!kind) return null;

  const data = await file.arrayBuffer();
  const meta: AssetMeta = {
    id: crypto.randomUUID(),
    name: file.name,
    kind,
    mimeType: file.type || (kind === "model-gltf" ? DEFAULT_MODEL_MIME : "application/octet-stream"),
  };
  await saveAsset({ ...meta, data });
  await refreshAssets();
  return meta;
}

/**
 * Fase 10C — importa un file già presente nella project folder aperta
 * (doppio click su un modello in `ProjectTree.tsx`/`ProjectFolderGrid.tsx`),
 * scaricandone i byte via host-agent (`fetchProjectFile`, `GET
 * /project/file`) invece che da un `File` scelto con `<input
 * type="file">`. Costruisce un `File` in memoria dai byte ricevuti e riusa
 * INTERAMENTE `importAssetFile` sotto: stessa rilevazione del formato
 * (`detectAssetKind`, per estensione/MIME), stessa persistenza IndexedDB,
 * stesso comportamento sui duplicati (nessuna deduplica — punto aperto 3
 * confermato dall'utente: ogni import genera un nuovo record, coerente col
 * flusso `<input type="file">` esistente). Restituisce `null` se il
 * download fallisce (agente non raggiungibile, percorso non valido) o se
 * il formato non è supportato in questa fase.
 */
export async function importProjectFile(relativePath: string, name: string): Promise<AssetMeta | null> {
  const result = await fetchProjectFile(relativePath);
  if (!result) return null;
  const file = new File([result.data], name, { type: result.mimeType });
  return importAssetFile(file);
}

/** Rimuove un asset importato e aggiorna `assetsStore`. Un GameObject nella scena già istanziato da questo asset (`sourceAssetId`) NON viene toccato: resta con la sua mesh già caricata, semplicemente non sarà più ricostruibile dopo un futuro reload della scena — stesso compromesso di un riferimento penzolante già accettato altrove (punto aperto 5). */
export async function removeAsset(id: string): Promise<void> {
  await deleteAsset(id);
  await refreshAssets();
}

/**
 * Risolve l'id di un asset a un object URL utilizzabile da GLTFLoader
 * (`attachGLTF`/`loadGLTF` in @engine/core, che caricano da URL, non da
 * payload in memoria). Restituisce `null` se l'asset non esiste più (es.
 * rimosso nel frattempo, o riferito da una scena salvata con un altro
 * profilo IndexedDB) — il chiamante (createEditorScene.ts) tollera questo
 * caso lasciando il GameObject senza mesh, invece di far fallire l'intero
 * caricamento della scena per un singolo asset mancante.
 *
 * L'URL restituito va rilasciato con `URL.revokeObjectURL` dal chiamante
 * una volta che GLTFLoader ha finito di leggerlo — non lo fa questa
 * funzione stessa: il momento giusto per farlo dipende da quando la
 * Promise di `attachGLTF`/`loadGLTF` si risolve, che questo modulo non può
 * osservare.
 */
export async function getAssetObjectURL(id: string): Promise<string | null> {
  const record = await loadAsset(id);
  if (!record) return null;
  const blob = new Blob([record.data], { type: record.mimeType });
  return URL.createObjectURL(blob);
}
