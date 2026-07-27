import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { assetsStore, editorSceneHandleStore } from "../store/editorStore.js";
import { importAssetFile, removeAsset, refreshAssets } from "../assets/assetsController.js";
import type { AssetMeta } from "../persistence/AssetPersistence.js";

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
 * Posizionato come riga a piena larghezza SOTTO Hierarchy/Viewport/
 * Inspector (vedi App.css `.editor-body`), non come quarta colonna: più
 * vicino alla convenzione Unity (Project window in basso) e non richiede
 * di restringere i tre pannelli esistenti.
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
        <button type="button" className="topbar-button" onClick={onImportClick}>
          Importa
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
      {assets.length === 0 ? (
        <p className="panel-placeholder">Nessun asset importato.</p>
      ) : (
        <ul className="assets-list">
          {assets.map((asset) => (
            <li key={asset.id} className="assets-row">
              <span className="assets-row-name">{asset.name}</span>
              <span className="assets-row-kind">{asset.kind === "model-gltf" ? "Modello" : "Texture"}</span>
              {asset.kind === "model-gltf" && (
                <button
                  type="button"
                  className="topbar-button"
                  disabled={!handle || addingId === asset.id}
                  onClick={() => void onAddToScene(asset)}
                >
                  {addingId === asset.id ? "Aggiunta…" : "Aggiungi alla scena"}
                </button>
              )}
              <button type="button" className="inspector-delete-button" onClick={() => void onRemove(asset)}>
                Rimuovi
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
