import { useEffect, useRef, useState } from "react";
import { sceneRootsStore, selectionStore, editorSceneHandleStore } from "../store/editorStore.js";
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
 *
 * Fase 6C.1: bottone "+" nell'header che apre un piccolo menu
 * Empty/Cube/Sphere/Plane — chiama `EditorSceneHandle.addGameObject`
 * (createEditorScene.ts), che aggiunge il nuovo GameObject alla scena viva
 * e lo seleziona subito. Disabilitato finché `editorSceneHandleStore` è
 * `null` (stesso gate già usato da Topbar.tsx per Save/Load). Nessun sync
 * di rete ancora — arriva in 6C.2.
 */
const ADD_OPTIONS: ReadonlyArray<{ kind: "empty" | "box" | "sphere" | "plane"; label: string }> = [
  { kind: "empty", label: "Empty" },
  { kind: "box", label: "Cube" },
  { kind: "sphere", label: "Sphere" },
  { kind: "plane", label: "Plane" },
];

export function Hierarchy(): JSX.Element {
  const roots = sceneRootsStore.useValue();
  const selected = selectionStore.useValue();
  const handle = editorSceneHandleStore.useValue();
  const nodes = buildHierarchy(roots);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Chiude il menu su un click/tap fuori dal suo contenitore — stesso
  // scopo di TunnelDialog.tsx (chiudibile), ma qui un popover leggero non
  // giustifica un intero componente dialog separato.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  function onAdd(kind: (typeof ADD_OPTIONS)[number]["kind"]): void {
    if (!handle) return;
    handle.addGameObject(kind);
    setMenuOpen(false);
  }

  return (
    <div className="panel side-panel">
      <div className="hierarchy-header">
        <h2 className="panel-title">Hierarchy</h2>
        <div className="hierarchy-add" ref={menuRef}>
          <button
            type="button"
            className="hierarchy-add-button"
            disabled={!handle}
            aria-label="Aggiungi GameObject"
            onClick={() => setMenuOpen((open) => !open)}
          >
            +
          </button>
          {menuOpen && (
            <ul className="hierarchy-add-menu">
              {ADD_OPTIONS.map((option) => (
                <li key={option.kind}>
                  <button type="button" className="hierarchy-add-option" onClick={() => onAdd(option.kind)}>
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
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
