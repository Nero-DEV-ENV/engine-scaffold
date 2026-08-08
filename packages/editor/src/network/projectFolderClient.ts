import { createExternalStore } from "../store/editorStore.js";
import { setTextureResolver, cachedTexturePaths, invalidateTexture } from "@engine/core";
import { texturePathsAffectedByChange } from "../scene/textureInvalidation.js";

/**
 * projectFolderClient.ts — Fase 10B: client HTTP per le route `/project/*`
 * esposte da `packages/host-agent` (Fase 10A, vedi
 * `packages/host-agent/src/projectFolder.ts`/`httpServer.ts`).
 *
 * Stesso processo host-agent di `hostAgentClient.ts` (stessa porta 4100):
 * la raggiungibilità è la STESSA, quindi questo modulo non introduce un
 * secondo meccanismo di connessione HTTP — la UI (`panels/ProjectTree.tsx`)
 * legge `agentConnectionStore`, già esportato da `hostAgentClient.ts`
 * (connesso via il WebSocket `/server/logs`), per sapere se l'agente è
 * online. Ogni chiamata HTTP qui resta un fetch puntuale, innescato da
 * un'azione esplicita dell'utente (apri cartella, espandi nodo) — mai un
 * poll/refresh automatico.
 *
 * Fase 10G — `ensureProjectWatchMonitoring()`/`projectChangeStore` sotto
 * sono l'eccezione: un canale WS DEDICATO (`/project/watch`, separato da
 * `/server/logs` — stessa logica di separazione già motivata lato
 * host-agent in `httpServer.ts`) per il watch automatico del filesystem,
 * stesso pattern di `ensureAgentMonitoring()` in `hostAgentClient.ts`
 * (connessione persistente, riconnessione automatica, nessun `disconnect`
 * simmetrico).
 *
 * `ProjectEntry`/`ProjectFolderState` duplicano la shape dei tipi omonimi
 * in `packages/host-agent/src/projectFolder.ts` invece di condividerli via
 * @engine/core — stesso confine di rete già motivato in
 * `hostAgentClient.ts` (@engine/core è il runtime del motore, non il
 * protocollo di controllo verso host-agent).
 */

export interface ProjectEntry {
  name: string;
  kind: "file" | "directory";
}

const DEFAULT_HTTP_URL = "http://localhost:4100";

function httpBaseUrl(): string {
  return import.meta.env.VITE_HOST_AGENT_HTTP_URL ?? DEFAULT_HTTP_URL;
}

/**
 * Fase 11B.1 — URL assoluta e direttamente fetchabile per `relativePath`
 * verso `GET /project/file` (stessa route di `fetchProjectFile` sotto, CORS
 * permissivo già confermato lato host-agent — vedi commento in
 * `httpServer.ts`). A differenza di `fetchProjectFile`, che scarica i byte
 * in un `ArrayBuffer` (pensato per `GLTFLoader`, che vuole un Blob URL
 * locale — vedi `assetsController.ts`), qui la URL host-agent stessa è
 * usabile DIRETTAMENTE da `THREE.TextureLoader`/`<img src>` senza alcun
 * passaggio Blob intermedio: una texture Albedo resta un riferimento VIVO
 * alla project folder (mai copiata in IndexedDB come un modello importato,
 * vedi JSDoc di `MeshRendererData.albedoMap` in types.ts), quindi non serve
 * mai "possedere" i byte lato editor, solo poterli richiedere quando serve.
 */
export function projectFileUrl(relativePath: string): string {
  return `${httpBaseUrl()}/project/file?path=${encodeURIComponent(relativePath)}`;
}

/**
 * Fase 11B.1 — registra `projectFileUrl` come `TextureResolver` di
 * `@engine/core` (vedi JSDoc lì) al primo import di questo modulo:
 * `packages/core` non può costruire da sé questa URL (non conosce porta/
 * override di host-agent, di competenza esclusiva di questo file), quindi
 * l'editor è l'unico posto sensato per registrarla. Side-effect a livello
 * di modulo (non un'esplicita chiamata da main.tsx/App.tsx): questo modulo
 * viene comunque importato molto presto nel bootstrap (Hierarchy/Inspector/
 * ProjectTree lo importano tutti), quindi il resolver è garantito registrato
 * ben prima che un `MeshRenderer` con `albedoMap` venga istanziato o
 * deserializzato da una scena.
 */
setTextureResolver(projectFileUrl);

/** Percorso della project root aperta lato host-agent, o `null` se nessuna. */
export const projectRootStore = createExternalStore<string | null>(null);

/**
 * Fase 10C — percorso relativo della cartella attualmente aperta
 * nell'Asset manager (doppio click su una cartella in `ProjectTree.tsx`),
 * o `null` se nessuna: in quel caso `AssetsPanel.tsx` mostra la lista
 * Assets classica (Fase 7, invariata) invece della griglia
 * (`ProjectFolderGrid.tsx`) — un solo pannello, una sola vista alla volta
 * (raccomandazione confermata dall'utente). Azzerato esplicitamente
 * all'apertura di una nuova root e alla chiusura, per non restare
 * "agganciato" a un percorso di una project folder ormai diversa/chiusa.
 */
export const viewedFolderStore = createExternalStore<string | null>(null);

/**
 * Fase 10G — ultima notifica ricevuta sul canale WS `/project/watch`:
 * i percorsi relativi (stile POSIX, "." per la root) delle cartelle
 * cambiate FUORI dall'editor (git pull, altro strumento, ecc.), già
 * raggruppate/deduplicate lato host-agent (debounce, vedi
 * `ProjectFolderSession.queueChangedPath`/`flushChangedPaths`). `null`
 * finché non arriva la prima notifica. `panels/ProjectTree.tsx` decide
 * quali fra questi ricaricare (`changedPathsToReload` in
 * `panels/projectTreeState.ts`) — questo modulo si limita a inoltrare il
 * messaggio, nessuna logica sui percorsi qui.
 */
export const projectChangeStore = createExternalStore<{ changedPaths: string[] } | null>(null);

/**
 * Fase 11B.2 — contatore incrementato ad ogni invalidazione di texture
 * (vedi `ws.onmessage` sotto): la thumbnail 2D in Inspector.tsx (`<img
 * src={projectFileUrl(...)}>`) è un percorso di rendering INDIPENDENTE dal
 * materiale 3D del Viewport (vedi JSDoc di `projectFileUrl` sopra) — il
 * browser mantiene la sua cache HTTP per quella URL a prescindere da
 * `invalidateTexture` (core), che tocca solo la `THREE.Texture` in
 * memoria. Senza questo contatore, dopo un'invalidazione il materiale 3D
 * si aggiorna correttamente ma la thumbnail resta quella vecchia (bug
 * scoperto in smoke-test): Inspector.tsx appende questo valore come
 * cache-buster all'URL della thumbnail per forzare un ri-fetch quando
 * cambia, indipendentemente da QUALE percorso sia stato invalidato — un
 * ri-fetch di una piccola thumbnail non necessaria per invalidazioni non
 * pertinenti è un costo accettabile, la semplicità di un contatore globale
 * batte il costo di tracciare per-percorso quali thumbnail sono montate
 * in questo momento.
 */
export const textureCacheVersionStore = createExternalStore<number>(0);

const WATCH_RECONNECT_DELAY_MS = 3000;

function watchWsUrl(): string {
  return `${httpBaseUrl().replace(/^http/, "ws")}/project/watch`;
}

let watchSocket: WebSocket | null = null;
let watchReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchMonitoringStarted = false;

function scheduleWatchReconnect(): void {
  if (watchReconnectTimer) return;
  watchReconnectTimer = setTimeout(() => {
    watchReconnectTimer = null;
    openWatchSocket();
  }, WATCH_RECONNECT_DELAY_MS);
}

function openWatchSocket(): void {
  const ws = new WebSocket(watchWsUrl());
  watchSocket = ws;

  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { kind: "changed"; changedPaths: string[] };
    projectChangeStore.set({ changedPaths: message.changedPaths });
    // Fase 11B.2 (punto aperto 5, deferito da 11B.1) — oltre a far
    // ricaricare l'albero (sopra), le stesse notifiche di cambiamento
    // invalidano le texture già in cache la cui cartella-genitore è fra
    // quelle segnalate: un MeshRenderer che le sta già mostrando
    // (Albedo/Normal/Roughness/Metalness/AO/Emissive) si aggiorna in tempo
    // reale, vedi `invalidateTexture`/`subscribeTextureUpdates` in
    // AssetLoader.ts. Logica di corrispondenza cartella↔texture pura e
    // testata a sé in `textureInvalidation.ts`.
    const affectedPaths = texturePathsAffectedByChange(message.changedPaths, cachedTexturePaths());
    for (const path of affectedPaths) {
      invalidateTexture(path);
    }
    // Bump del contatore SOLO se almeno una texture è stata davvero
    // invalidata sopra: evita un ri-fetch di ogni thumbnail montata per
    // notifiche di cambiamento che non riguardano alcuna texture in cache
    // (es. uno script o un modello modificato).
    if (affectedPaths.length > 0) {
      textureCacheVersionStore.set(textureCacheVersionStore.get() + 1);
    }
  };

  ws.onclose = () => {
    if (watchSocket === ws) watchSocket = null;
    scheduleWatchReconnect();
  };
}

/**
 * Avvia la sottoscrizione al canale WS `/project/watch` (Fase 10G).
 * Idempotente — stesso pattern di `ensureAgentMonitoring()` in
 * `hostAgentClient.ts`: sicuro da chiamare più volte (es. React
 * StrictMode), resta collegato per tutta la vita dell'editor (nessun
 * `disconnect` simmetrico), riconnette da sé se l'agente non è
 * raggiungibile o non ha ancora una root aperta — in quel caso il
 * canale semplicemente non emette nulla, nessun errore da gestire qui.
 */
export function ensureProjectWatchMonitoring(): void {
  if (watchMonitoringStarted) return;
  watchMonitoringStarted = true;
  openWatchSocket();
}

/**
 * Interroga `GET /project/status` e allinea `projectRootStore` allo stato
 * reale dell'agente — l'agente può avere già una root aperta da prima di
 * questo mount (nessuna persistenza lato editor in questa fase, vedi punto
 * 2 confermato dall'utente: il percorso NON sopravvive a un reload
 * dell'editor, ma la project root resta aperta lato host-agent finché non
 * viene chiusa esplicitamente o l'agente non viene riavviato).
 * Silenzioso se l'agente non è raggiungibile: `agentConnectionStore`
 * riflette già quel caso tramite il WebSocket esistente.
 */
export async function refreshProjectStatus(): Promise<void> {
  try {
    const response = await fetch(`${httpBaseUrl()}/project/status`);
    if (!response.ok) return;
    const state = (await response.json()) as { rootPath: string | null };
    projectRootStore.set(state.rootPath);
  } catch {
    // Agente non raggiungibile: nessuna azione qui, vedi commento sopra.
  }
}

export type OpenProjectRootResult = { ok: true } | { ok: false; error: string };

/**
 * Apre `absolutePath` come project root (`POST /project/open`),
 * sostituendo silenziosamente una root già aperta — punto 3 confermato
 * dall'utente: nessuna conferma richiesta in UI in questa fase, coerente
 * col comportamento già permesso lato `ProjectFolderSession.openRoot`.
 */
export async function openProjectRoot(absolutePath: string): Promise<OpenProjectRootResult> {
  try {
    const response = await fetch(`${httpBaseUrl()}/project/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: absolutePath }),
    });
    const body = (await response.json()) as { rootPath?: string | null; error?: string };
    if (!response.ok) {
      return { ok: false, error: body.error ?? "Errore sconosciuto." };
    }
    projectRootStore.set(body.rootPath ?? absolutePath);
    viewedFolderStore.set(null);
    return { ok: true };
  } catch {
    return { ok: false, error: "Agente non raggiungibile." };
  }
}

/**
 * Chiude la project root corrente (`POST /project/close`). 202 (chiusa) e
 * 409 (non c'era nulla da chiudere) significano entrambi "nessuna root
 * aperta ora": `projectRootStore` torna a `null` in entrambi i casi.
 */
export async function closeProjectRoot(): Promise<void> {
  try {
    const response = await fetch(`${httpBaseUrl()}/project/close`, { method: "POST" });
    if (response.ok || response.status === 409) {
      projectRootStore.set(null);
      viewedFolderStore.set(null);
    }
  } catch {
    // Agente non raggiungibile: nessuna azione, stato invariato.
  }
}

/**
 * Elenca il contenuto di `relativePath` (`"."` per la root) via
 * `GET /project/list` — chiamata on-demand quando l'utente espande un
 * nodo (niente scansione ricorsiva eager, vedi obiettivo dichiarato di
 * Fase 10B). Restituisce `null` se l'agente non è raggiungibile, se non
 * c'è una root aperta, o se il percorso non è valido/leggibile —
 * `panels/projectTreeState.ts` (reducer) tratta questi casi in modo uniforme
 * come "errore di caricamento" del nodo.
 */
export async function listProjectDirectory(relativePath: string): Promise<ProjectEntry[] | null> {
  try {
    const url = `${httpBaseUrl()}/project/list?path=${encodeURIComponent(relativePath)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = (await response.json()) as { entries: ProjectEntry[] };
    return body.entries;
  } catch {
    return null;
  }
}

export interface ProjectFileResult {
  data: ArrayBuffer;
  mimeType: string;
}

/**
 * Fase 10C — scarica i byte grezzi di `relativePath` via `GET
 * /project/file` (nuova route lato host-agent, vedi
 * `packages/host-agent/src/httpServer.ts`): usata per importare un
 * modello scelto nell'albero (`ProjectTree.tsx`) o nella griglia cartella
 * (`ProjectFolderGrid.tsx`) senza passare da `<input type="file">` (Fase
 * 7). `null` se l'agente non è raggiungibile, se non c'è una root aperta,
 * o se il percorso non è valido/leggibile come file — stesso trattamento
 * "silenzioso" di `listProjectDirectory` sopra, il chiamante decide come
 * mostrarlo (es. `assets/assetsController.ts` restituisce a sua volta
 * `null`, coerente col contratto già esistente di `importAssetFile`).
 */
export async function fetchProjectFile(relativePath: string): Promise<ProjectFileResult | null> {
  try {
    const url = `${httpBaseUrl()}/project/file?path=${encodeURIComponent(relativePath)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.arrayBuffer();
    const mimeType = response.headers.get("Content-Type") ?? "application/octet-stream";
    return { data, mimeType };
  } catch {
    return null;
  }
}

/**
 * Fase 10F — scrive `contents` (testo) in `relativePath` dentro la project
 * root corrente via `POST /project/file` (nuova route lato host-agent, vedi
 * `packages/host-agent/src/httpServer.ts`), simmetrica a `fetchProjectFile`
 * sopra. `false` se l'agente non è raggiungibile, se non c'è una root
 * aperta, o se la scrittura fallisce lato host-agent — stesso trattamento
 * "silenzioso" delle altre funzioni di questo modulo, il chiamante
 * (`actions/sceneActions.ts`) decide come mostrarlo.
 */
export async function writeProjectFile(relativePath: string, contents: string): Promise<boolean> {
  try {
    const url = `${httpBaseUrl()}/project/file?path=${encodeURIComponent(relativePath)}`;
    const response = await fetch(url, { method: "POST", body: contents });
    return response.ok;
  } catch {
    return false;
  }
}
