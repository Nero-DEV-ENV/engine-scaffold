import { useEffect, useState } from "react";
import { FolderIcon, ModelIcon, TextureIcon, FileIcon, BackIcon } from "../icons.js";
import { viewedFolderStore, listProjectDirectory } from "../network/projectFolderClient.js";
import type { ProjectEntry } from "../network/projectFolderClient.js";
import { editorSceneHandleStore, selectionStore } from "../store/editorStore.js";
import { importProjectFile } from "../assets/assetsController.js";
import { joinProjectPath, classifyProjectEntry, breadcrumbSegments, parentProjectPath } from "./projectTreeState.js";
import { MeshRenderer, serializeComponent } from "@engine/core";
import { armedTextureSlotStore, disarmTextureSlot, resolveTextureAssignment } from "../scene/textureAssignment.js";

type GridLoadState =
  | { status: "loading" }
  | { status: "loaded"; entries: readonly ProjectEntry[] }
  | { status: "error"; error: string };

/**
 * ProjectFolderGrid.tsx — Fase 10C: vista "contenuto cartella" dell'Asset
 * manager, mostrata al posto della lista Assets classica
 * (`.project-panel-content` in `AssetsPanel.tsx`) quando `viewedFolderStore`
 * non è `null` (doppio click su una cartella in `ProjectTree.tsx`). Un solo
 * pannello, una sola vista alla volta — raccomandazione confermata
 * dall'utente, non una scelta implicita.
 *
 * A differenza della lista Assets classica (righe, icona piccola inline —
 * Fase 7, invariata), qui ogni voce è un riquadro con icona GRANDE (stessa
 * SVG dell'albero, ingrandita via CSS — nessuna variante "large" delle
 * icone stesse) e nome centrato sotto, stile "griglia icone" di un file
 * browser — introdotto SOLO qui (punto aperto confermato dall'utente: la
 * lista Assets classica resta a righe, invariata).
 *
 * Navigazione: breadcrumb cliccabile per saltare a un livello qualunque del
 * percorso, più un bottone "indietro" (`BackIcon`) per risalire di un
 * livello alla volta. Risalire dal primo livello (`parentProjectPath`
 * restituisce `null`) esce dalla griglia, tornando alla lista Assets
 * classica — stessa semantica di `viewedFolderStore === null`.
 *
 * Interazione con le entry (doppio click, click singolo nessuna azione —
 * niente selezione visiva qui, a differenza dell'albero: non c'è un'azione
 * successiva che la userebbe):
 * - cartella → naviga dentro (aggiorna `viewedFolderStore`).
 * - modello (glTF/GLB) → importa (`importProjectFile`) e aggiunge subito
 *   alla scena corrente, stessa azione one-shot di `ProjectTree.tsx`.
 * - texture/altro → nessuna azione (punto aperto 4 confermato, fuori scope
 *   di questa fase).
 */
export function ProjectFolderGrid(): JSX.Element | null {
  const path = viewedFolderStore.useValue();
  // Fase 11B.1 — letto UNA volta qui (mai dentro il .map() sulle entry
  // sotto, e PRIMA dell'early return su path===null sotto): stesso motivo
  // del fix analogo in ProjectTree.tsx (bug reale in smoke-test).
  const armedTextureSlot = armedTextureSlotStore.useValue();
  const [state, setState] = useState<GridLoadState>({ status: "loading" });
  const [importingPath, setImportingPath] = useState<string | null>(null);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setState({ status: "loading" });
    void listProjectDirectory(path).then((entries) => {
      if (cancelled) return;
      if (entries === null) {
        setState({ status: "error", error: "Impossibile leggere la cartella." });
      } else {
        setState({ status: "loaded", entries });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (path === null) return null;

  function goTo(nextPath: string | null): void {
    viewedFolderStore.set(nextPath);
  }

  async function onEntryDoubleClick(entry: ProjectEntry, entryPath: string): Promise<void> {
    if (entry.kind === "directory") {
      goTo(entryPath);
      return;
    }
    const classification = classifyProjectEntry(entry);
    if (classification === "texture") {
      onAssignTexture(entryPath);
      return;
    }
    if (classification !== "model" || importingPath) return;
    setImportingPath(entryPath);
    try {
      const meta = await importProjectFile(entryPath, entry.name);
      const handle = editorSceneHandleStore.get();
      if (meta && handle) {
        await handle.addImportedModel(meta.id, meta.name);
      }
    } finally {
      setImportingPath(null);
    }
  }

  /**
   * Fase 11B.1, punto aperto 1 — stessa logica di `ProjectTree.tsx`
   * (`onAssignTexture` lì): completa l'assegnazione SOLO se uno slot è
   * stato armato dal bottone "Scegli texture…" in Inspector.tsx, altrimenti
   * no-op (stesso comportamento "nessuna azione" di prima di questa fase).
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

  const segments = breadcrumbSegments(path);

  return (
    <div className="project-folder-grid">
      <div className="project-grid-breadcrumb">
        <button
          type="button"
          className="icon-button project-grid-back-button"
          onClick={() => goTo(parentProjectPath(path))}
          aria-label="Torna indietro"
          title="Torna indietro"
        >
          <BackIcon />
        </button>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const segmentPath = segments.slice(0, index + 1).join("/");
          return (
            <span key={segmentPath} className="project-grid-breadcrumb-segment-wrap">
              {index > 0 && (
                <span className="project-grid-breadcrumb-sep" aria-hidden="true">
                  /
                </span>
              )}
              <button
                type="button"
                className={`project-grid-breadcrumb-segment${isLast ? " project-grid-breadcrumb-current" : ""}`}
                disabled={isLast}
                onClick={() => goTo(segmentPath)}
              >
                {segment}
              </button>
            </span>
          );
        })}
      </div>

      {state.status === "loading" && <p className="project-tree-status">Caricamento…</p>}
      {state.status === "error" && <p className="project-tree-status project-tree-status-error">{state.error}</p>}
      {state.status === "loaded" && state.entries.length === 0 && (
        <p className="panel-placeholder">Cartella vuota.</p>
      )}
      {state.status === "loaded" && state.entries.length > 0 && (
        <ul className="project-grid">
          {state.entries.map((entry) => {
            const entryPath = joinProjectPath(path, entry.name);
            const classification = classifyProjectEntry(entry);
            const isImporting = importingPath === entryPath;
            return (
              <li
                key={entryPath}
                className={`project-grid-item${isImporting ? " project-grid-item-importing" : ""}`}
                onDoubleClick={() => void onEntryDoubleClick(entry, entryPath)}
                title={
                  classification === "model"
                    ? isImporting
                      ? "Importazione in corso…"
                      : "Doppio click per aggiungere alla scena"
                    : classification === "texture" && armedTextureSlot
                      ? "Doppio click per assegnare al materiale selezionato"
                      : entry.name
                }
              >
                <span className="project-grid-icon">
                  {classification === "folder" && <FolderIcon />}
                  {classification === "model" && <ModelIcon />}
                  {classification === "texture" && <TextureIcon />}
                  {classification === "other" && <FileIcon />}
                </span>
                <span className="project-grid-name">{entry.name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
