import { useEffect, useReducer, useState } from "react";
import type { CSSProperties } from "react";
import { FolderIcon, FileIcon, ModelIcon, TextureIcon } from "../icons.js";
import {
  projectRootStore,
  viewedFolderStore,
  refreshProjectStatus,
  openProjectRoot,
  closeProjectRoot,
  listProjectDirectory,
  projectChangeStore,
  ensureProjectWatchMonitoring,
} from "../network/projectFolderClient.js";
import { agentConnectionStore, ensureAgentMonitoring } from "../network/hostAgentClient.js";
import { connectionStore, manifestEntriesStore, sendPublishManifestEntries } from "../network/collabClient.js";
import { editorSceneHandleStore, selectionStore } from "../store/editorStore.js";
import { importProjectFile } from "../assets/assetsController.js";
import { MeshRenderer, serializeComponent } from "@engine/core";
import { armedTextureSlotStore, disarmTextureSlot, resolveTextureAssignment } from "../scene/textureAssignment.js";
import {
  PROJECT_TREE_ROOT_PATH,
  INITIAL_PROJECT_TREE_STATE,
  projectTreeReducer,
  joinProjectPath,
  classifyProjectEntry,
  changedPathsToReload,
} from "./projectTreeState.js";

const INDENT_PX_PER_DEPTH = 14;

/**
 * ProjectTree.tsx — Fase 10B: albero navigabile reale sulla project
 * folder, al posto del placeholder statico `.project-panel-tree` di Fase
 * 9. Wiring React attorno alla logica pura di `panels/projectTreeState.ts`
 * (reducer) e al client HTTP di `network/projectFolderClient.ts`.
 *
 * Domande aperte poste all'utente prima di questa implementazione, tutte
 * confermate senza modifiche (vedi documento di continuazione):
 * 1. Agente non raggiungibile → riusa il pallino di stato già usato da
 *    `HostAgentPanel.tsx` (`.host-status-dot`), non un secondo pattern
 *    d'errore parallelo.
 * 2. Percorso digitato NON persistito in questa fase (si svuota ad ogni
 *    reload) — persistenza vera rimandata a Fase 10D.
 * 3. Sostituzione di una root già aperta: nessuna conferma UI in v1.
 * 4. Stato di espansione: solo React state locale, non persistito.
 * 5. Selezione file/cartella: stato visivo già in questa fase, MA senza
 *    alcuna azione di import collegata — quella arriva in Fase 10C.
 *
 * Nessuna scansione ricorsiva eager: ogni cartella viene interrogata via
 * `listProjectDirectory` solo quando l'utente la espande esplicitamente
 * (vedi obiettivo dichiarato di questa fase).
 *
 * Fase 10C — doppio click collegato (click singolo resta invariato,
 * espandi/collassa per le cartelle):
 * - su un file classificato "model" → importa (`importProjectFile`,
 *   scarica i byte via host-agent) E aggiunge subito alla scena corrente,
 *   stesso `EditorSceneHandle.addImportedModel` già usato dalla lista
 *   Assets classica in `AssetsPanel.tsx`. Texture/altro: nessuna azione
 *   (punto aperto 4 confermato, fuori scope).
 * - su una cartella → apre il suo contenuto nell'Asset manager
 *   (`viewedFolderStore`, letto da `ProjectFolderGrid.tsx` in
 *   `AssetsPanel.tsx`), che sostituisce temporaneamente la lista Assets
 *   classica finché l'utente non torna alla radice via breadcrumb.
 *
 * Fase 10E — sync multiutente del manifest via Colyseus (5 punti del
 * documento di continuazione, tutte le raccomandazioni confermate senza
 * modifiche):
 * 1. Lazy, non eager: nessuna scansione ricorsiva nuova, il manifest è
 *    sincronizzato un livello alla volta, esattamente come `loadDirectory`
 *    già fa qui sotto.
 * 2. Nessuna autorità unica: qualunque client con una root aperta
 *    pubblica/ripubblica un livello (`sendPublishManifestEntries` in
 *    `loadDirectory` sotto) — chi pubblica per ultimo per un dato percorso
 *    vince (vedi `EditorRoom.ts`, `publishManifestEntries`).
 * 3. Trigger: SOLO l'espansione (o ri-espansione) di un nodo — mai un push
 *    spontaneo da filesystem watch, fuori scope fino a un'eventuale 10G.
 * 4. Una entry presente nel manifest condiviso ma assente sul disco locale
 *    di QUESTO client viene mostrata comunque (nessun flag "verificato" in
 *    più) — un doppio click che tenta di importarla fallisce silenziosamente
 *    come già oggi per qualunque intent non valido (`importProjectFile`
 *    restituisce `null`).
 * 5. Scope v1: solo struttura (percorsi/nome/tipo) — nessuna evidenziazione
 *    "aggiunto di recente".
 *
 * Quando connessi alla collab room, il manifest sincronizzato (`
 * manifestEntriesStore` in `collabClient.ts`) è la fonte PREFERITA per ogni
 * livello che già possiede un'entry lì — chiunque l'abbia pubblicato,
 * incluso questo stesso client — così un secondo utente vede comparire/
 * sparire file in un nodo che ha già espanso, senza doverlo ri-espandere
 * manualmente. Quando NON connessi, comportamento invariato rispetto a
 * Fase 10B-10D (solo scansione locale via host-agent).
 */
export function ProjectTree(): JSX.Element {
  const rootPath = projectRootStore.useValue();
  const connection = agentConnectionStore.useValue();
  const agentReachable = connection === "connected";
  const collabStatus = connectionStore.useValue();
  const manifestByPath = manifestEntriesStore.useValue();
  // Fase 11B.1 — letto UNA volta qui (mai dentro il .map() sulle entry
  // sotto): un hook chiamato condizionalmente per ogni entry violerebbe le
  // Rules of Hooks (il numero di chiamate varierebbe con la classificazione
  // e il conteggio delle entry della cartella) — bug reale riscontrato in
  // smoke-test ("Rendered more hooks than during the previous render").
  const armedTextureSlot = armedTextureSlotStore.useValue();

  const [pathInput, setPathInput] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [tree, dispatch] = useReducer(projectTreeReducer, INITIAL_PROJECT_TREE_STATE);

  useEffect(() => {
    // Idempotente (vedi hostAgentClient.ts): sicuro da chiamare anche se
    // HostAgentPanel.tsx l'ha già avviato altrove — questo componente non
    // deve dipendere dall'ordine di montaggio dei fratelli.
    ensureAgentMonitoring();
    void refreshProjectStatus();
    // Fase 10G — stesso discorso, canale separato: idempotente, sicuro da
    // richiamare a ogni mount.
    ensureProjectWatchMonitoring();
  }, []);

  useEffect(() => {
    dispatch({ type: "reset" });
    if (rootPath !== null) {
      // Fase 10D — se il campo è ancora vuoto, `rootPath` non nullo qui
      // significa che l'host-agent aveva già una root (riaperta da sé
      // all'avvio del processo, vedi projectFolder.ts `restore()`, o
      // rimasta viva da prima di questo mount): senza questo, il campo
      // testo resterebbe vuoto pur con l'albero già popolato sotto.
      // Forma funzionale per non dover aggiungere `pathInput` alle
      // dipendenze dell'effect (che deve restare legato solo a `rootPath`,
      // vedi commento sotto).
      setPathInput((current) => (current.length === 0 ? rootPath : current));
      void loadDirectory(PROJECT_TREE_ROOT_PATH);
    }
    // Solo `rootPath` deve far ripartire il caricamento: `dispatch` è
    // stabile fra i render (garanzia di useReducer) e `loadDirectory`
    // chiude sempre sulla versione corrente, nessuna dipendenza da
    // aggiungere qui.
  }, [rootPath]);

  async function loadDirectory(path: string): Promise<void> {
    dispatch({ type: "load-start", path });
    const entries = await listProjectDirectory(path);
    if (entries === null) {
      dispatch({ type: "load-error", path, error: "Impossibile leggere la cartella." });
      return;
    }
    dispatch({ type: "load-success", path, entries });
    // Fase 10E, punto 2: contribuisce questo livello al manifest condiviso
    // — no-op se non connessi alla collab room. Nessuna autorità unica:
    // chiunque con una root aperta può pubblicare/ripubblicare un livello.
    sendPublishManifestEntries(path, entries);
  }

  useEffect(() => {
    // Fase 10E, punti 2+3: quando connessi, il manifest sincronizzato è la
    // fonte preferita per ogni livello che già possiede un'entry lì —
    // ma SOLO per la root e per i nodi che questo client ha già espanso
    // (mai un livello mai guardato: il trigger resta l'espansione, non un
    // push spontaneo). Quando non connessi, non fa nulla: comportamento
    // invariato rispetto a Fase 10B-10D.
    if (collabStatus.status !== "connected") return;
    for (const path of [PROJECT_TREE_ROOT_PATH, ...tree.expandedPaths]) {
      const entries = manifestByPath.get(path);
      if (entries !== undefined) {
        dispatch({ type: "load-success", path, entries });
      }
    }
  }, [collabStatus, manifestByPath, tree.expandedPaths]);

  const lastProjectChange = projectChangeStore.useValue();
  useEffect(() => {
    // Fase 10G — un cambiamento rilevato FUORI dall'editor (git pull,
    // altro strumento) su una cartella già tracciata (root o nodo
    // espanso): ricarica via `loadDirectory`, che aggiorna la vista
    // locale E ripubblica il manifest condiviso (Fase 10E) per quel
    // livello — stesso percorso già preso da un'espansione manuale, solo
    // innescato automaticamente stavolta. Mai un livello mai guardato
    // (`changedPathsToReload`, vedi projectTreeState.ts).
    if (lastProjectChange === null) return;
    for (const path of changedPathsToReload(lastProjectChange.changedPaths, tree.expandedPaths)) {
      void loadDirectory(path);
    }
  }, [lastProjectChange, tree.expandedPaths]);

  async function onOpen(): Promise<void> {
    setOpenError(null);
    const result = await openProjectRoot(pathInput.trim());
    if (!result.ok) setOpenError(result.error);
  }

  async function onClose(): Promise<void> {
    await closeProjectRoot();
    setOpenError(null);
    setPathInput("");
  }

  function onToggleDirectory(path: string): void {
    const wasExpanded = tree.expandedPaths.has(path);
    dispatch({ type: "toggle-expand", path });
    // Fase 10E, fix scoperto in smoke-test: PRIMA si ricaricava solo se
    // `tree.nodes.get(path) === undefined` (comportamento ereditato da Fase
    // 10B), quindi una ri-espansione dopo un collasso riusava dati ormai
    // stantii e non ripubblicava mai un livello aggiornato sul manifest
    // condiviso — contraddiceva il trigger dichiarato ("ogni espansione o
    // ri-espansione"). Ora ricarica SEMPRE a un'espansione (mai al
    // collasso): costo trascurabile (host-agent locale), e tiene la vista
    // locale coerente col disco reale anche fuori dal contesto Fase 10E.
    if (!wasExpanded) {
      void loadDirectory(path);
    }
  }

  /** Fase 10C, punto 1: doppio click su un modello → importa e aggiunge subito alla scena, un solo gesto. */
  async function onImportModel(entryPath: string, name: string): Promise<void> {
    if (importingPath) return;
    setImportingPath(entryPath);
    try {
      const meta = await importProjectFile(entryPath, name);
      const handle = editorSceneHandleStore.get();
      if (meta && handle) {
        await handle.addImportedModel(meta.id, meta.name);
      }
    } finally {
      setImportingPath(null);
    }
  }

  /** Fase 10C, punto 5: doppio click su una cartella → la apre nell'Asset manager (ProjectFolderGrid.tsx). */
  function onOpenFolderInAssetManager(entryPath: string): void {
    viewedFolderStore.set(entryPath);
  }

  /**
   * Fase 11B.1, punto aperto 1: doppio click su una texture → completa
   * l'assegnazione SOLO se uno slot è stato precedentemente armato dal
   * bottone "Scegli texture…" in Inspector.tsx (`armedTextureSlotStore`).
   * Nessuno slot armato → no-op, stesso comportamento "nessuna azione" di
   * prima di questa fase (Fase 10C, punto aperto 4). `resolveTextureAssignment`
   * (logica pura, textureAssignment.ts) rifiuta anche se la selezione è
   * cambiata nel frattempo o non ha più un MeshRenderer.
   */
  function onAssignTexture(entryPath: string): void {
    const armedSlot = armedTextureSlotStore.get();
    if (!armedSlot) return;
    const selected = selectionStore.get();
    const meshRenderer = selected?.getComponent(MeshRenderer) ?? null;
    const meshRendererData = meshRenderer ? serializeComponent(meshRenderer) : null;
    const next = resolveTextureAssignment(
      armedSlot,
      selected?.id ?? null,
      meshRendererData && meshRendererData.type === "MeshRenderer" ? meshRendererData : null,
      entryPath
    );
    if (!next || !selected) return;
    editorSceneHandleStore.get()?.updateComponent(selected, next);
    disarmTextureSlot();
  }

  function indentStyle(depth: number): CSSProperties {
    return { paddingLeft: depth * INDENT_PX_PER_DEPTH };
  }

  function renderChildren(path: string, depth: number): JSX.Element | null {
    const node = tree.nodes.get(path);
    if (node === undefined || node.loadState === "loading") {
      return (
        <p className="project-tree-status" style={indentStyle(depth)}>
          Caricamento…
        </p>
      );
    }
    if (node.loadState === "error") {
      return (
        <p className="project-tree-status project-tree-status-error" style={indentStyle(depth)}>
          {node.error}
        </p>
      );
    }

    return (
      <ul className="project-tree-list">
        {node.entries.map((entry) => {
          const entryPath = joinProjectPath(path, entry.name);
          const classification = classifyProjectEntry(entry);
          const expanded = tree.expandedPaths.has(entryPath);
          const isDirectory = entry.kind === "directory";
          const isImporting = importingPath === entryPath;

          return (
            <li key={entryPath}>
              <div
                className={`project-tree-row${tree.selectedPath === entryPath ? " project-tree-row-selected" : ""}${isImporting ? " project-tree-row-importing" : ""}`}
                style={indentStyle(depth)}
                onClick={() => {
                  dispatch({ type: "select", path: entryPath });
                  if (isDirectory) onToggleDirectory(entryPath);
                }}
                onDoubleClick={() => {
                  if (isDirectory) {
                    onOpenFolderInAssetManager(entryPath);
                  } else if (classification === "model") {
                    void onImportModel(entryPath, entry.name);
                  } else if (classification === "texture") {
                    onAssignTexture(entryPath);
                  }
                }}
                title={
                  isDirectory
                    ? "Doppio click per aprire nell'Asset manager"
                    : classification === "model"
                      ? isImporting
                        ? "Importazione in corso…"
                        : "Doppio click per aggiungere alla scena"
                      : classification === "texture" && armedTextureSlot
                        ? "Doppio click per assegnare al materiale selezionato"
                        : entry.name
                }
              >
                {isDirectory ? (
                  <span
                    className={`project-tree-chevron${expanded ? " project-tree-chevron-expanded" : ""}`}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="project-tree-chevron-spacer" aria-hidden="true" />
                )}
                <span className="project-tree-icon">
                  {classification === "folder" && <FolderIcon />}
                  {classification === "model" && <ModelIcon />}
                  {classification === "texture" && <TextureIcon />}
                  {classification === "other" && <FileIcon />}
                </span>
                <span className="project-tree-name" title={entry.name}>
                  {entry.name}
                </span>
              </div>
              {isDirectory && expanded && renderChildren(entryPath, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="project-panel-tree">
      <div className="project-tree-open-row">
        <input
          type="text"
          className="project-tree-path-input"
          placeholder="Percorso assoluto…"
          value={pathInput}
          disabled={!agentReachable}
          onChange={(event) => setPathInput(event.target.value)}
        />
        {rootPath === null ? (
          <button
            type="button"
            className="project-tree-open-button"
            disabled={!agentReachable || pathInput.trim().length === 0}
            onClick={() => void onOpen()}
          >
            Apri
          </button>
        ) : (
          <button type="button" className="project-tree-open-button" disabled={!agentReachable} onClick={() => void onClose()}>
            Chiudi
          </button>
        )}
      </div>

      {!agentReachable && (
        <div className="project-tree-agent-status" title="Agente non raggiunto — avvia start-hidden.ps1">
          <span
            className="host-status-dot host-status-dot-unreachable"
            role="img"
            aria-label="Agente non raggiunto — avvia start-hidden.ps1"
          />
          <span aria-hidden="true">Agente non raggiunto</span>
        </div>
      )}

      {agentReachable && openError && <p className="project-tree-status project-tree-status-error">{openError}</p>}

      {agentReachable && rootPath !== null && (
        <>
          <p className="project-tree-root-path" title={rootPath}>
            {rootPath}
          </p>
          {renderChildren(PROJECT_TREE_ROOT_PATH, 0)}
        </>
      )}

      {agentReachable && rootPath === null && !openError && (
        <p className="project-panel-tree-placeholder">Nessuna cartella progetto aperta.</p>
      )}
    </div>
  );
}
