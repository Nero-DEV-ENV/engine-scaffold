import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { assetsStore, editorSceneHandleStore } from "../store/editorStore.js";
import { importAssetFile, removeAsset, refreshAssets } from "../assets/assetsController.js";
import type { AssetMeta } from "../persistence/AssetPersistence.js";
import { PlusIcon, RemoveIcon, ModelIcon } from "../icons.js";
import { ProjectTree } from "./ProjectTree.js";

/**
 * AssetsPanel — pannello "Project window"-style (Fase 7, punto aperto 4:
 * pannello dedicato PRIMA del drag&drop su Viewport/Hierarchy, rimandato a
 * un miglioramento successivo). Elenca gli asset importati
 * (`assetsStore`, popolato da `assets/assetsController.ts`), permette di
 * importarne di nuovi via file picker nativo e — per i modelli GLTF/GLB —
 * di istanziarli come nuovo GameObject nella scena corrente.
 *
 * Le texture sono elencate ma non hanno ancora un'azione "Aggiungi alla
 * scena": applicarle a un materiale è scope di Fase 10 (editing materiali
 * PBR), non di questa fase — vengono importate/persistite già ora perché
 * il formato/storage è lo stesso dei modelli (stesso store, stesso
 * pannello), ma restano "in attesa" fino a quando l'Inspector saprà
 * referenziarle da un MeshRenderer.
 *
 * Fase 9 — riposizionato dentro la grid di `.editor-body` (area "assets"),
 * fianco a fianco con Hierarchy nella riga inferiore (il Viewport occupa
 * l'intera riga superiore, Inspector resta l'unica colonna a piena
 * altezza), come il Project panel nello screenshot Unity di riferimento
 * fornito dall'utente. Il markup è diviso in due colonne interne:
 * `ProjectTree` (Fase 10B — albero navigabile reale sulla project folder
 * via host-agent `/project/*`, vedi `panels/ProjectTree.tsx`; sostituisce
 * il placeholder statico `.project-panel-tree` di Fase 9) accanto a
 * `.project-panel-content`, che contiene la stessa lista/logica di prima
 * (import/lista/rimuovi, invariata — resta un percorso parallelo, non
 * collegato all'albero: l'integrazione arriva in Fase 10C).
 *
 * Fase 9 — su richiesta dell'utente il bottone testuale "Aggiungi alla
 * scena" per i modelli è sostituito da un'icona SVG puramente decorativa
 * (`ModelIcon` sotto, stesso linguaggio "flat/outline sottile" del resto
 * del restyle): il doppio click per aggiungere il modello alla scena è
 * sul NOME dell'asset (`.assets-row-name-interactive`), non più
 * sull'icona (precisazione dell'utente) — stessa funzione
 * `onAddToScene`/stesso guard `addingId` di prima, cambia solo il
 * trigger UI. Nota di accessibilità: un doppio click non ha un
 * equivalente da tastiera nativo, e il nome non è più un elemento
 * focusabile come lo era il bottone-icona di una versione precedente —
 * limite noto, non risolto in questa fase.
 */
export function AssetsPanel(): JSX.Element {
  const assets = assetsStore.useValue();
  const handle = editorSceneHandleStore.useValue();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    void refreshAssets();
  }, []);

  function onImportClick(): void {
    setImportError(null);
    fileInputRef.current?.click();
  }

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Reset subito, non a fine funzione: permette di reimportare lo STESSO
    // file due volte di seguito (un secondo `change` con lo stesso path
    // non scatterebbe altrimenti, comportamento noto di <input type="file">).
    event.target.value = "";
    if (!file) return;

    const meta = await importAssetFile(file);
    setImportError(meta ? null : `Formato non supportato: "${file.name}" (solo .gltf/.glb per modelli, PNG/JPG per texture)`);
  }

  async function onAddToScene(asset: AssetMeta): Promise<void> {
    if (!handle || addingId) return;
    setAddingId(asset.id);
    try {
      await handle.addImportedModel(asset.id, asset.name);
    } finally {
      setAddingId(null);
    }
  }

  async function onRemove(asset: AssetMeta): Promise<void> {
    await removeAsset(asset.id);
  }

  return (
    <div className="panel assets-panel">
      <div className="assets-header">
        <h2 className="panel-title">Assets</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onImportClick}
          aria-label="Importa asset"
          title="Importa asset"
        >
          <PlusIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gltf,.glb,image/*"
          className="assets-file-input"
          onChange={(event) => void onFileChosen(event)}
        />
      </div>
      {importError && <p className="assets-error">{importError}</p>}
      <div className="project-panel">
        {/* Fase 10B — sostituisce il placeholder statico di Fase 9: vedi
            ProjectTree.tsx per l'albero navigabile reale (host-agent
            /project/*). */}
        <ProjectTree />
        <div className="project-panel-content">
          {assets.length === 0 ? (
            <p className="panel-placeholder">Nessun asset importato.</p>
          ) : (
            <ul className="assets-list">
              {assets.map((asset) => (
                <li key={asset.id} className="assets-row">
                  {asset.kind === "model-gltf" && (
                    <span className="assets-row-icon">
                      <ModelIcon />
                    </span>
                  )}
                  <span
                    className={
                      asset.kind === "model-gltf"
                        ? `assets-row-name assets-row-name-interactive${
                            addingId === asset.id ? " assets-row-name-adding" : ""
                          }`
                        : "assets-row-name"
                    }
                    onDoubleClick={asset.kind === "model-gltf" ? () => void onAddToScene(asset) : undefined}
                    title={
                      asset.kind === "model-gltf"
                        ? addingId === asset.id
                          ? "Aggiunta in corso…"
                          : "Doppio click per aggiungere alla scena"
                        : undefined
                    }
                  >
                    {asset.name}
                  </span>
                  <span className="assets-row-kind">{asset.kind === "model-gltf" ? "Modello" : "Texture"}</span>
                  <button
                    type="button"
                    className="inspector-delete-button"
                    onClick={() => void onRemove(asset)}
                    aria-label={`Rimuovi ${asset.name}`}
                    title="Rimuovi"
                  >
                    <RemoveIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
