import { useEffect, useRef, useState } from "react";
import { createEditorScene, type EditorSceneHandle } from "../scene/createEditorScene.js";
import { sceneRootsStore, selectionStore, editorSceneHandleStore } from "../store/editorStore.js";
import { buildSceneContextMenuItems } from "../scene/contextMenuItems.js";
import { ContextMenu } from "./ContextMenu.js";

/**
 * Viewport — pannello che ospita il canvas three.js.
 *
 * `createEditorScene` è async (createRenderer negozia l'adapter/device
 * GPU). Per restare corretto sotto doppio-invoke degli effect (React
 * StrictMode, o un fast-refresh di Vite durante `pnpm dev:editor`) l'effect
 * usa un flag `cancelled`: se lo smontaggio arriva PRIMA che la promise si
 * risolva, l'handle viene comunque distrutto (`dispose()`) appena pronto,
 * invece di lasciare un renderer/canvas orfano collegato a un container già
 * smontato.
 *
 * Il resize NON usa `attachAutoResize` di @engine/core: quella funzione
 * ascolta `window.resize` e legge `window.innerWidth/innerHeight`, corretto
 * per un canvas a piena finestra (apps/playground) ma sbagliato qui, dove
 * il canvas è uno dei tre pannelli e può cambiare dimensione anche senza
 * che la finestra del browser cambi (es. drag di uno splitter fra pannelli,
 * feature non ancora presente ma per cui questo resize deve già essere pronto).
 * Un ResizeObserver sul container risolve entrambi i casi.
 *
 * Fase 4B: alla risoluzione di `createEditorScene` pubblica i GameObject
 * radice su `sceneRootsStore` (letto da Hierarchy.tsx) — la selezione e
 * l'highlight nel Viewport restano invece interamente dentro
 * `createEditorScene.ts` (raycast sul canvas + sottoscrizione a
 * `selectionStore`), perché quel modulo ha già in mano scene/camera/
 * renderer e non deve diventare un componente React solo per farlo. Fase
 * 5B: pubblica anche l'`EditorSceneHandle` stesso su `editorSceneHandleStore`
 * — serve alla Topbar (Save/Load) per raggiungerlo, dato che non condivide
 * alcun antenato React con questo componente. Allo smontaggio, tutti e tre
 * gli store (`sceneRootsStore`, `selectionStore`, `editorSceneHandleStore`)
 * vengono svuotati: altrimenti un rimontaggio (HMR, o un futuro secondo
 * viewport) mostrerebbe in Hierarchy dei GameObject della scena precedente
 * già distrutta da `Engine._resetAll()`, o la Topbar terrebbe un handle
 * ormai disposto.
 *
 * Fase 8: `onContextMenu` sul container (non sul canvas direttamente —
 * `container` lo contiene sempre, l'evento nativo risale comunque fino a
 * qui) sopprime il menu nativo del browser e apre `ContextMenu` con
 * "Elimina" o "Aggiungi GameObject" (`buildSceneContextMenuItems`, stesso
 * modulo condiviso con Hierarchy.tsx). Il target del menu è letto da
 * `selectionStore.get()` al momento dell'evento, SENZA un raycast proprio:
 * `onPointerDown`/`onPointerUp` in createEditorScene.ts non filtrano per
 * `event.button`, quindi già aggiornano `selectionStore` in risposta a un
 * click col tasto DESTRO esattamente come con quello sinistro — e
 * l'ordine nativo degli eventi del browser (pointerdown → pointerup →
 * contextmenu) garantisce che `selectionStore` rifletta già l'oggetto
 * giusto quando `onContextMenu` legge il suo valore. Effect separato dal
 * bootstrap async sopra: il container esiste subito al mount, non serve
 * attendere che `createEditorScene` risolva per poter intercettare
 * `contextmenu`.
 */
export function Viewport(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    }

    container.addEventListener("contextmenu", onContextMenu);
    return () => container.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let handle: EditorSceneHandle | null = null;
    let resizeObserver: ResizeObserver | null = null;

    createEditorScene(container)
      .then((createdHandle) => {
        if (cancelled) {
          createdHandle.dispose();
          return;
        }
        handle = createdHandle;
        sceneRootsStore.set(createdHandle.roots);
        editorSceneHandleStore.set(createdHandle);
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          const { width, height } = entry.contentRect;
          handle?.setSize(Math.round(width), Math.round(height));
        });
        resizeObserver.observe(container);
      })
      .catch((bootstrapError: unknown) => {
        console.error("[editor] avvio della scena nel viewport fallito:", bootstrapError);
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
        }
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      handle?.dispose();
      sceneRootsStore.set([]);
      selectionStore.set(null);
      editorSceneHandleStore.set(null);
    };
  }, []);

  return (
    <div className="panel viewport-panel" ref={containerRef}>
      {error && (
        <div className="viewport-error" role="alert">
          Impossibile avviare il viewport: {error}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildSceneContextMenuItems(selectionStore.get(), editorSceneHandleStore.get())}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
