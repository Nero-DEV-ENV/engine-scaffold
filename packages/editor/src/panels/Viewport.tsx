import { useEffect, useRef, useState } from "react";
import { createEditorScene, type EditorSceneHandle } from "../scene/createEditorScene.js";

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
 */
export function Viewport(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    };
  }, []);

  return (
    <div className="panel viewport-panel" ref={containerRef}>
      {error && (
        <div className="viewport-error" role="alert">
          Impossibile avviare il viewport: {error}
        </div>
      )}
    </div>
  );
}
