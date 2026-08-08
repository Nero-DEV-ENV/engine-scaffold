import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GameObject } from "../core/GameObject.js";

export interface LoadedModel {
  /** GameObject "contenitore": la sua Transform è libera (posiziona/ruota/scala l'intero modello), l'intera gerarchia GLTF è appesa come figlio del suo Object3D. */
  gameObject: GameObject;
  /** Clip di animazione incluse nel file, se presenti (non riprodotte automaticamente — serviranno un AnimationMixer in una fase successiva). */
  animations: THREE.AnimationClip[];
  /** Risultato grezzo di GLTFLoader, per chi ha bisogno di accedere a cameras/scenes/parser direttamente. */
  gltf: GLTF;
}

/** Loader GLTFLoader condiviso: instanziarlo una sola volta evita di ricostruire il parser DRACO/KTX2 ad ogni load. */
let sharedLoader: GLTFLoader | null = null;

function getSharedLoader(): GLTFLoader {
  if (!sharedLoader) {
    sharedLoader = new GLTFLoader();
  }
  return sharedLoader;
}

/**
 * loadGLTFRaw — carica un asset .gltf/.glb e restituisce il risultato
 * grezzo di GLTFLoader, senza avvolgerlo in alcun GameObject. Estratta da
 * `loadGLTF` in Fase 7 perché `attachGLTF` (sotto) ha bisogno esattamente
 * dello stesso caricamento ma su un GameObject GIÀ ESISTENTE invece che
 * crearne uno nuovo — un'unica funzione privata evita di duplicare la
 * gestione del loader condiviso/Promise/errori in due punti.
 */
function loadGLTFRaw(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    getSharedLoader().load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (error) => {
        reject(new Error(`loadGLTF: impossibile caricare "${url}": ${String(error)}`));
      }
    );
  });
}

/**
 * loadGLTF — carica un asset .gltf/.glb e lo avvolge in un NUOVO GameObject,
 * pronto per essere aggiunto alla scena three.js con
 * `scene.add(model.gameObject._object3D)`.
 *
 * I materiali arrivano già PBR (MeshStandardMaterial/MeshPhysicalMaterial)
 * perché è il comportamento di default di GLTFLoader — non serve alcuna
 * conversione aggiuntiva lato motore.
 *
 * Nota: GLTFLoader (addon three.js) importa la sua copia di "three" dal
 * bare specifier "three", non da "three/webgpu" — vedi il commento
 * architetturale in Renderer.ts sul perché questo non è un problema per
 * `scene.add()`/`renderer.render()`.
 */
export function loadGLTF(url: string, name?: string): Promise<LoadedModel> {
  return loadGLTFRaw(url).then((gltf) => {
    const gameObject = new GameObject(name ?? deriveNameFromUrl(url));
    gameObject._object3D.add(gltf.scene);
    return { gameObject, animations: gltf.animations, gltf };
  });
}

/**
 * attachGLTF — Fase 7: carica un asset .gltf/.glb e appende la sua
 * gerarchia a un GameObject GIÀ ESISTENTE, invece di crearne uno nuovo
 * (a differenza di `loadGLTF` sopra). Usata dall'editor per due percorsi
 * distinti che condividono lo stesso bisogno — "il contenitore esiste già,
 * serve solo attaccargli la mesh":
 * 1. Import di un asset dal pannello Assets su un GameObject appena creato
 *    (con id/nome propri già assegnati dall'editor).
 * 2. Ricostruzione al caricamento di una scena salvata: il GameObject
 *    "contenitore" arriva già da `deserializeScene` (con id/transform/
 *    sourceAssetId propri, vedi SceneSerializer.ts), qui viene solo
 *    riattaccata la gerarchia three.js che il formato SceneData non
 *    serializza.
 *
 * Non restituisce un `GameObject` (il chiamante ce l'ha già): solo
 * animazioni/gltf grezzo, per lo stesso motivo di `LoadedModel.animations`/
 * `LoadedModel.gltf` sopra.
 */
export function attachGLTF(
  gameObject: GameObject,
  url: string
): Promise<{ animations: THREE.AnimationClip[]; gltf: GLTF }> {
  return loadGLTFRaw(url).then((gltf) => {
    gameObject._object3D.add(gltf.scene);
    return { animations: gltf.animations, gltf };
  });
}

function deriveNameFromUrl(url: string): string {
  const fileName = url.split("/").pop() ?? url;
  return fileName.replace(/\.(gltf|glb)$/i, "") || "Model";
}

// ---- Fase 11B.1 — mappe texture (Albedo) per MeshRenderer ---------------

/**
 * TextureResolver — `packages/core` non ha alcuna conoscenza della project
 * folder/host-agent (stesso confine architetturale già motivato in
 * `hostAgentClient.ts`/`projectFolderClient.ts` lato editor: @engine/core è
 * il runtime del motore, non il protocollo di rete verso l'agente locale).
 * Un `MeshRendererData.albedoMap` è però un percorso RELATIVO alla project
 * folder (vedi types.ts) — serve quindi un punto d'iniezione con cui
 * chiunque ospiti il motore (oggi solo `packages/editor`) traduce quel
 * percorso in una URL effettivamente caricabile da `THREE.TextureLoader`.
 * `packages/editor/src/network/projectFolderClient.ts` registra questo
 * resolver una sola volta al caricamento del modulo (vedi lì). Se nessun
 * resolver è registrato (es. `packages/cli`/playground senza host-agent),
 * `requestTexture` sotto restituisce `null` e il chiamante applica
 * `MISSING_TEXTURE` — comportamento comunque corretto, non un errore.
 */
export type TextureResolver = (relativePath: string) => string;

let textureResolver: TextureResolver | null = null;

/** Registra (o rimuove, passando `null`) il resolver percorso-relativo→URL. */
export function setTextureResolver(resolver: TextureResolver | null): void {
  textureResolver = resolver;
}

/**
 * MISSING_TEXTURE — placeholder "texture mancante" (scacchiera magenta/nero
 * 4×4, convenzione comune nei motori 3D per un riferimento texture rotto).
 * `THREE.DataTexture` costruita da un TypedArray, non da `<canvas>`/`Image`:
 * i test di questo package girano in Node puro (Vitest, nessun DOM — vedi
 * Physics.test.ts), un Canvas reale non sarebbe disponibile lì. Costruita
 * pigramente (non a livello di modulo) e mai disposta: è un singolo asset
 * condiviso e statico per tutta la vita del processo, non legato al ciclo
 * di vita di alcun `MeshRenderer` (a differenza delle texture reali sotto,
 * refcounted e disposte in `releaseTexture`).
 */
let missingTexture: THREE.DataTexture | null = null;

export function getMissingTexture(): THREE.DataTexture {
  if (missingTexture) return missingTexture;
  const size = 4;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const isMagenta = (x + y) % 2 === 0;
      data[i] = isMagenta ? 255 : 0;
      data[i + 1] = 0;
      data[i + 2] = isMagenta ? 255 : 0;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  missingTexture = texture;
  return missingTexture;
}

/** Loader condiviso per le texture Albedo, stesso motivo di `sharedLoader` (GLTF) sopra. */
let sharedTextureLoader: THREE.TextureLoader | null = null;

function getSharedTextureLoader(): THREE.TextureLoader {
  if (!sharedTextureLoader) {
    sharedTextureLoader = new THREE.TextureLoader();
  }
  return sharedTextureLoader;
}

/**
 * Cache condivisa per percorso relativo, con reference counting: più
 * `MeshRenderer` che assegnano la stessa texture (stesso percorso)
 * condividono la stessa istanza `THREE.Texture` invece di ricaricarla e
 * decodificarla una volta per materiale — `dispose()` reale solo quando
 * l'ultimo riferimento viene rilasciato (`releaseTexture` sotto). Tenere la
 * cache per Promise (non solo per Texture risolta) evita richieste
 * duplicate se due `MeshRenderer` assegnano lo stesso percorso nella
 * stessa finestra di caricamento.
 *
 * `listeners` — Fase 11B.2: chi vuole essere notificato se la `Texture` di
 * questa entry viene sostituita da `invalidateTexture` sotto (il file su
 * disco è cambiato mentre è già visualizzato). Popolato da
 * `subscribeTextureUpdates`, mai direttamente. Stessa entry, stesso
 * `refCount` prima e dopo un'invalidazione: solo l'istanza `Texture`
 * sottostante cambia, l'identità della entry di cache no.
 */
interface TextureCacheEntry {
  promise: Promise<THREE.Texture>;
  refCount: number;
  listeners: Set<(texture: THREE.Texture) => void>;
}

const textureCache = new Map<string, TextureCacheEntry>();

/**
 * requestTexture — richiede la `THREE.Texture` per `relativePath` (Albedo),
 * incrementando il refcount della entry di cache. Restituisce `null` se
 * nessun `TextureResolver` è registrato (chiamante applica
 * `MISSING_TEXTURE` sincronamente, nessun errore). La Promise restituita
 * può rigettare (percorso non risolvibile lato host-agent, rete non
 * raggiungibile, formato immagine non decodificabile) — il chiamante
 * (MeshRenderer._applyAlbedoMap) cattura l'errore e applica
 * `MISSING_TEXTURE`. Ogni chiamata che restituisce una Promise (risolta o
 * no) DEVE essere bilanciata da una `releaseTexture(relativePath)`
 * quando quel riferimento non serve più — stesso principio di
 * retain/release, non un semplice cache "usa e getta".
 */
export function requestTexture(relativePath: string): Promise<THREE.Texture> | null {
  if (!textureResolver) return null;
  const cached = textureCache.get(relativePath);
  if (cached) {
    cached.refCount++;
    return cached.promise;
  }
  const url = textureResolver(relativePath);
  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    getSharedTextureLoader().load(
      url,
      (texture) => resolve(texture),
      undefined,
      (error) => reject(new Error(`requestTexture: impossibile caricare "${relativePath}": ${String(error)}`))
    );
  });
  textureCache.set(relativePath, { promise, refCount: 1, listeners: new Set() });
  return promise;
}

/**
 * releaseTexture — rilascia un riferimento precedentemente ottenuto da
 * `requestTexture` per lo stesso `relativePath`. Al refcount zero, dispone
 * la `THREE.Texture` reale (se la Promise si era risolta: se era ancora in
 * volo o rigettata, non c'è nulla da disporre, la entry viene solo
 * rimossa dalla cache) e rimuove la entry — nessun leak per texture non
 * più referenziate da alcun `MeshRenderer`.
 */
export function releaseTexture(relativePath: string): void {
  const cached = textureCache.get(relativePath);
  if (!cached) return;
  cached.refCount--;
  if (cached.refCount > 0) return;
  textureCache.delete(relativePath);
  cached.promise.then(
    (texture) => texture.dispose(),
    () => {
      // Promise rigettata: nessuna THREE.Texture reale da disporre.
    }
  );
}

/**
 * subscribeTextureUpdates — Fase 11B.2: registra `callback` per essere
 * notificato quando la texture in cache per `relativePath` viene sostituita
 * da `invalidateTexture` sotto (il file su disco è cambiato mentre è già
 * assegnato/visualizzato da un `MeshRenderer` — vedi collegamento al canale
 * watch `/project/watch` in `projectFolderClient.ts` lato editor). Va
 * chiamata SOLO subito dopo un `requestTexture(relativePath)` che ha
 * restituito una Promise non-null (cioè un riferimento è stato acquisito
 * per quel percorso): se nessuna entry di cache esiste ancora per quel
 * percorso, è un no-op difensivo che restituisce una unsubscribe vuota —
 * non dovrebbe capitare nell'uso corretto da `MeshRenderer`/`TextureMapSlot`.
 * Restituisce una funzione di annullamento, da chiamare ESATTAMENTE nello
 * stesso momento in cui il riferimento viene rilasciato con
 * `releaseTexture` per lo stesso percorso — mai lasciare un listener vivo
 * dopo che il proprio materiale non usa più quella texture.
 */
export function subscribeTextureUpdates(
  relativePath: string,
  callback: (texture: THREE.Texture) => void
): () => void {
  const cached = textureCache.get(relativePath);
  if (!cached) return () => {};
  cached.listeners.add(callback);
  return () => cached.listeners.delete(callback);
}

/**
 * invalidateTexture — Fase 11B.2 (deferito da 11B.1): forza un
 * ricaricamento da zero della texture in cache per `relativePath`,
 * notificando ogni sottoscrittore (`subscribeTextureUpdates` sopra) con la
 * nuova `THREE.Texture` non appena disponibile — così un `MeshRenderer` che
 * la sta già mostrando (Albedo/Normal/Roughness/Metalness/AO/Emissive) si
 * aggiorna in tempo reale senza bisogno di riassegnare la mappa a mano.
 * No-op se nessuna entry di cache esiste per quel percorso (nessuno lo sta
 * visualizzando: nulla da invalidare qui, un futuro `requestTexture` per
 * quello stesso percorso creerà comunque una entry nuova che legge la
 * versione aggiornata dal disco) o se nessun `TextureResolver` è
 * registrato. Il `refCount`/i `listeners` esistenti restano sulla STESSA
 * entry di cache (stessi retainer, stessa identità) — cambia solo la
 * `Texture` sottostante a cui puntano.
 */
export function invalidateTexture(relativePath: string): void {
  const cached = textureCache.get(relativePath);
  if (!cached || !textureResolver) return;
  const baseUrl = textureResolver(relativePath);
  // Bug scoperto in smoke-test: senza un cache-buster, questa è la STESSA
  // URL usata dalla richiesta originale di `requestTexture` — il browser
  // serve i byte vecchi dalla propria cache HTTP per quella URL esatta
  // (indipendentemente da `THREE.Cache`, disattivato di default e comunque
  // non il livello di cache coinvolto qui), quindi il ricaricamento
  // "riuscirebbe" restituendo silenziosamente la stessa texture di prima.
  // Un parametro di query univoco forza sempre un fetch di rete reale.
  // `baseUrl.includes("?")` perché `TextureResolver` (implementato
  // dall'editor come `projectFileUrl`, vedi JSDoc di `setTextureResolver`
  // sotto) include già una propria query string (`?path=...`).
  const cacheBustSeparator = baseUrl.includes("?") ? "&" : "?";
  const url = `${baseUrl}${cacheBustSeparator}_invalidatedAt=${Date.now()}`;
  const oldPromise = cached.promise;
  const newPromise = new Promise<THREE.Texture>((resolve, reject) => {
    getSharedTextureLoader().load(
      url,
      (texture) => resolve(texture),
      undefined,
      (error) => reject(new Error(`invalidateTexture: impossibile ricaricare "${relativePath}": ${String(error)}`))
    );
  });
  cached.promise = newPromise;
  newPromise
    .then((texture) => {
      cached.listeners.forEach((listener) => listener(texture));
      // La vecchia texture (se si era già risolta) non è più referenziata
      // da alcun materiale dopo la notifica sincrona sopra a tutti i
      // sottoscrittori: disporla libera la risorsa GPU. Se era ancora in
      // volo o era stata rigettata, non c'è nulla da disporre (stesso
      // trattamento di `releaseTexture` sopra).
      oldPromise.then(
        (oldTexture) => oldTexture.dispose(),
        () => {}
      );
    })
    .catch(() => {
      // Ricaricamento fallito (es. il file è stato cancellato nella stessa
      // finestra di debounce in cui è arrivata la notifica di modifica):
      // notifica comunque i sottoscrittori con MISSING_TEXTURE, stesso
      // fallback già usato da requestTexture/MeshRenderer per un caricamento
      // iniziale fallito — non lasciarli agganciati alla texture ormai
      // stantia precedente.
      cached.listeners.forEach((listener) => listener(getMissingTexture()));
    });
}

/**
 * cachedTexturePaths — Fase 11B.2: percorsi relativi attualmente presenti
 * in cache (indipendentemente dal refcount). Usata SOLO da
 * `projectFolderClient.ts` lato editor per sapere, quando arriva una
 * notifica dal canale watch `/project/watch`, quali percorsi in cache
 * ricadono nelle cartelle segnalate come cambiate e vanno quindi passati a
 * `invalidateTexture` — `packages/core` non ha altrimenti bisogno di
 * esporre l'intera cache all'esterno.
 */
export function cachedTexturePaths(): string[] {
  return Array.from(textureCache.keys());
}
