import { useEffect, useReducer, useState } from "react";
import type { CSSProperties } from "react";
import { FolderIcon, FileIcon, ModelIcon } from "../icons.js";
import {
  projectRootStore,
  refreshProjectStatus,
  openProjectRoot,
  closeProjectRoot,
  listProjectDirectory,
} from "../network/projectFolderClient.js";
import { agentConnectionStore, ensureAgentMonitoring } from "../network/hostAgentClient.js";
import {
  PROJECT_TREE_ROOT_PATH,
  INITIAL_PROJECT_TREE_STATE,
  projectTreeReducer,
  joinProjectPath,
  classifyProjectEntry,
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
 */
export function ProjectTree(): JSX.Element {
  const rootPath = projectRootStore.useValue();
  const connection = agentConnectionStore.useValue();
  const agentReachable = connection === "connected";

  const [pathInput, setPathInput] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [tree, dispatch] = useReducer(projectTreeReducer, INITIAL_PROJECT_TREE_STATE);

  useEffect(() => {
    // Idempotente (vedi hostAgentClient.ts): sicuro da chiamare anche se
    // HostAgentPanel.tsx l'ha già avviato altrove — questo componente non
    // deve dipendere dall'ordine di montaggio dei fratelli.
    ensureAgentMonitoring();
    void refreshProjectStatus();
  }, []);

  useEffect(() => {
    dispatch({ type: "reset" });
    if (rootPath !== null) {
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
  }

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
    if (!wasExpanded && tree.nodes.get(path) === undefined) {
      void loadDirectory(path);
    }
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

          return (
            <li key={entryPath}>
              <div
                className={`project-tree-row${tree.selectedPath === entryPath ? " project-tree-row-selected" : ""}`}
                style={indentStyle(depth)}
                onClick={() => {
                  dispatch({ type: "select", path: entryPath });
                  if (isDirectory) onToggleDirectory(entryPath);
                }}
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
                  {(classification === "texture" || classification === "other") && <FileIcon />}
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
