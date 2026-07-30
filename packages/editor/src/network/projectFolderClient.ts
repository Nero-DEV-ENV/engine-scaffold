import { createExternalStore } from "../store/editorStore.js";

/**
 * projectFolderClient.ts — Fase 10B: client HTTP per le route `/project/*`
 * esposte da `packages/host-agent` (Fase 10A, vedi
 * `packages/host-agent/src/projectFolder.ts`/`httpServer.ts`).
 *
 * Stesso processo host-agent di `hostAgentClient.ts` (stessa porta 4100):
 * la raggiungibilità è la STESSA, quindi questo modulo non introduce un
 * secondo meccanismo di connessione — la UI (`panels/ProjectTree.tsx`)
 * legge `agentConnectionStore`, già esportato da `hostAgentClient.ts`
 * (connesso via il WebSocket `/server/logs`), per sapere se l'agente è
 * online. Nessun canale WS dedicato per `/project/*` in questa fase (come
 * già notato in `projectFolder.ts` lato host-agent): ogni chiamata qui è
 * un fetch HTTP puntuale, innescato da un'azione esplicita dell'utente
 * (apri cartella, espandi nodo) — mai un poll/refresh automatico.
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
