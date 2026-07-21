import { sceneRootsStore, selectionStore } from "../store/editorStore.js";
import { buildHierarchy, type HierarchyNode } from "../scene/hierarchy.js";
import type { GameObject } from "@engine/core";

/**
 * Hierarchy — albero reale dei GameObject della scena corrente (Fase 4B).
 *
 * Legge `sceneRootsStore`/`selectionStore` (vedi store/editorStore.ts):
 * Viewport.tsx pubblica i GameObject radice quando `createEditorScene`
 * risolve, e `createEditorScene.ts` stesso aggiorna `selectionStore` in
 * risposta al click/raycast sul canvas — un click su una riga qui aggiorna
 * lo stesso store, quindi il Viewport si accorge del cambio (evidenzia
 * l'oggetto) senza che questo componente sappia nulla del rendering three.js.
 *
 * AmbientLight/KeyLight compaiono come righe normali, selezionabili come
 * qualunque altro GameObject — decisione motivata in createEditorScene.ts,
 * vicino a dove viene costruito l'array `roots`.
 *
 * Click su una riga: seleziona sempre quel GameObject (mai un toggle).
 * Deselezionare si fa cliccando sullo spazio vuoto nel Viewport (vedi
 * createEditorScene.ts), non ripetendo il click sulla stessa riga.
 */
export function Hierarchy(): JSX.Element {
  const roots = sceneRootsStore.useValue();
  const selected = selectionStore.useValue();
  const nodes = buildHierarchy(roots);

  return (
    <div className="panel side-panel">
      <h2 className="panel-title">Hierarchy</h2>
      {nodes.length === 0 ? (
        <p className="panel-placeholder">Nessuna scena caricata.</p>
      ) : (
        <ul className="hierarchy-tree">
          {nodes.map((node) => (
            <HierarchyRow key={node.gameObject._object3D.id} node={node} selected={selected} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function HierarchyRow({
  node,
  selected,
  depth,
}: {
  node: HierarchyNode;
  selected: GameObject | null;
  depth: number;
}): JSX.Element {
  const isSelected = selected === node.gameObject;

  return (
    <li>
      <button
        type="button"
        className={isSelected ? "hierarchy-row hierarchy-row-selected" : "hierarchy-row"}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => selectionStore.set(node.gameObject)}
      >
        {node.gameObject.name}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <HierarchyRow
              key={child.gameObject._object3D.id}
              node={child}
              selected={selected}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
