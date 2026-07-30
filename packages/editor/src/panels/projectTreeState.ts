import type { ProjectEntry } from "../network/projectFolderClient.js";

/**
 * projectTreeState.ts — Fase 10B: logica pura per il componente
 * `panels/ProjectTree.tsx` (costruzione del percorso relativo dei figli,
 * classificazione visiva dei tipi riconosciuti, e il reducer che governa
 * espansione/caricamento/selezione dell'albero) — stesso pattern già
 * usato per `resolveShortcutAction` (shortcuts/globalShortcuts.ts),
 * `buildSceneContextMenuItems` (scene/contextMenuItems.ts) e
 * `clampPanelWidth` (panels/resizablePanel.ts): la logica pura si testa,
 * il wiring React (`ProjectTree.tsx`) no — vedi convenzioni di progetto.
 *
 * NOME FILE: deliberatamente `projectTreeState.ts`, non `projectTree.ts`
 * — quest'ultimo differirebbe da `ProjectTree.tsx` solo per la maiuscola
 * iniziale, il che rompe la risoluzione dei moduli su filesystem
 * case-insensitive (Windows, macOS di default): bug reale riscontrato
 * dall'utente in dev, con Vite che risolveva l'import al file sbagliato.
 *
 * Stato modellato come mappa PIATTA per percorso relativo (non albero
 * annidato): più semplice da aggiornare/testare, ed è comunque coerente
 * con l'API di host-agent, che restituisce un livello alla volta
 * (`GET /project/list` per singola cartella, niente scansione ricorsiva
 * eager di tutto l'albero in un colpo solo — vedi obiettivo dichiarato di
 * questa fase).
 */

/** Percorso relativo della project root stessa (passato a `GET /project/list?path=.`). */
export const PROJECT_TREE_ROOT_PATH = ".";

export type ProjectEntryClassification = "folder" | "model" | "texture" | "other";

const MODEL_EXTENSIONS: ReadonlySet<string> = new Set([".gltf", ".glb"]);
const TEXTURE_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg"]);

/**
 * Classifica una entry per la distinzione visiva richiesta al punto 4
 * dell'obiettivo dichiarato ("magari già oggi una distinzione visiva per
 * i tipi riconosciuti glTF/GLB/PNG/JPG vs altri") — SOLO visualizzazione:
 * nessuna azione di import collegata qui, quella resta Fase 10C.
 */
export function classifyProjectEntry(entry: ProjectEntry): ProjectEntryClassification {
  if (entry.kind === "directory") return "folder";
  const dotIndex = entry.name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? entry.name.slice(dotIndex).toLowerCase() : "";
  if (MODEL_EXTENSIONS.has(extension)) return "model";
  if (TEXTURE_EXTENSIONS.has(extension)) return "texture";
  return "other";
}

/**
 * Costruisce il percorso relativo di un figlio di `parentPath`.
 * `PROJECT_TREE_ROOT_PATH` (".") è un caso speciale: nessun prefisso "./"
 * nel risultato, coerente con quanto si aspetta `GET /project/list?path=`.
 */
export function joinProjectPath(parentPath: string, childName: string): string {
  return parentPath === PROJECT_TREE_ROOT_PATH ? childName : `${parentPath}/${childName}`;
}

/**
 * Fase 10C — scompone un percorso relativo (MAI la root ".", solo un
 * sottopercorso reale come "Assets/Textures") nei suoi segmenti, per la
 * breadcrumb di `ProjectFolderGrid.tsx`.
 */
export function breadcrumbSegments(relativePath: string): string[] {
  return relativePath.split("/");
}

/**
 * Percorso del genitore di `relativePath` dentro la project folder, per la
 * risalita di un livello nella griglia cartella (Fase 10C). `null` se
 * `relativePath` è già un elemento di primo livello (es. "Assets"):
 * risalire ulteriormente esce dalla griglia, tornando alla lista Assets
 * classica — stessa semantica di `viewedFolderStore` in
 * `network/projectFolderClient.ts` (`null` = nessuna cartella in vista).
 */
export function parentProjectPath(relativePath: string): string | null {
  const segments = relativePath.split("/");
  segments.pop();
  return segments.length === 0 ? null : segments.join("/");
}

/**
 * Fase 10G — dati i percorsi relativi segnalati come cambiati dal watch
 * automatico (`network/projectFolderClient.ts`, canale WS
 * `/project/watch`), restituisce quali fra questi vanno ricaricati ORA:
 * solo la root (`PROJECT_TREE_ROOT_PATH`, sempre tracciata: il primo
 * `useEffect` di `ProjectTree.tsx` la carica al mount) e i nodi che questo
 * client ha già espanso — mai un livello mai guardato. Stesso invariante
 * già rispettato dall'effetto che applica il manifest sincronizzato
 * (Fase 10E): il watch aggiunge un secondo TRIGGER a quello manuale
 * (espansione), non un push indiscriminato per l'intero albero.
 */
export function changedPathsToReload(changedPaths: readonly string[], expandedPaths: ReadonlySet<string>): string[] {
  return changedPaths.filter((path) => path === PROJECT_TREE_ROOT_PATH || expandedPaths.has(path));
}

export type ProjectNodeLoadState = "idle" | "loading" | "loaded" | "error";

export interface ProjectTreeNode {
  readonly loadState: ProjectNodeLoadState;
  readonly entries: readonly ProjectEntry[];
  readonly error?: string;
}

export interface ProjectTreeState {
  /** Percorsi (cartelle) attualmente espansi nell'albero — punto 4 confermato: solo React state locale, non persistito. */
  readonly expandedPaths: ReadonlySet<string>;
  /** Contenuto/stato di caricamento per percorso relativo, root inclusa (`PROJECT_TREE_ROOT_PATH`). */
  readonly nodes: ReadonlyMap<string, ProjectTreeNode>;
  /** Entry attualmente selezionata (punto 5 confermato: stato visivo già in questa fase, nessuna azione di import collegata — quella resta Fase 10C). */
  readonly selectedPath: string | null;
}

export const INITIAL_PROJECT_TREE_STATE: ProjectTreeState = {
  expandedPaths: new Set(),
  nodes: new Map(),
  selectedPath: null,
};

export type ProjectTreeAction =
  | { type: "reset" }
  | { type: "toggle-expand"; path: string }
  | { type: "load-start"; path: string }
  | { type: "load-success"; path: string; entries: readonly ProjectEntry[] }
  | { type: "load-error"; path: string; error: string }
  | { type: "select"; path: string };

/**
 * Reducer puro per `ProjectTree.tsx` — nessun accesso a rete/DOM qui:
 * l'orchestrazione async (chiamare `listProjectDirectory` e dispatchare
 * `load-*` al risultato) resta nel componente, stesso confine già usato
 * per `onAddToScene`/`onFileChosen` in `AssetsPanel.tsx` (impuri, a
 * differenza della logica pura estratta a sé).
 */
export function projectTreeReducer(state: ProjectTreeState, action: ProjectTreeAction): ProjectTreeState {
  switch (action.type) {
    case "reset":
      return INITIAL_PROJECT_TREE_STATE;

    case "toggle-expand": {
      const expandedPaths = new Set(state.expandedPaths);
      if (expandedPaths.has(action.path)) {
        expandedPaths.delete(action.path);
      } else {
        expandedPaths.add(action.path);
      }
      return { ...state, expandedPaths };
    }

    case "load-start": {
      const nodes = new Map(state.nodes);
      nodes.set(action.path, { loadState: "loading", entries: [] });
      return { ...state, nodes };
    }

    case "load-success": {
      const nodes = new Map(state.nodes);
      nodes.set(action.path, { loadState: "loaded", entries: action.entries });
      return { ...state, nodes };
    }

    case "load-error": {
      const nodes = new Map(state.nodes);
      nodes.set(action.path, { loadState: "error", entries: [], error: action.error });
      return { ...state, nodes };
    }

    case "select":
      return { ...state, selectedPath: action.path };

    default:
      return state;
  }
}
