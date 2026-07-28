import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Hierarchy } from "./panels/Hierarchy.js";
import { Viewport } from "./panels/Viewport.js";
import { Inspector } from "./panels/Inspector.js";
import { Topbar } from "./panels/Topbar.js";
import { AssetsPanel } from "./panels/AssetsPanel.js";
import { HostAgentPanel } from "./panels/HostAgentPanel.js";
import { PwaUpdateBanner } from "./PwaUpdateBanner.js";
import { useGlobalEditorShortcuts } from "./shortcuts/globalShortcuts.js";
import {
  clampPanelWidth,
  HIERARCHY_DEFAULT_WIDTH_PX,
  HIERARCHY_MIN_WIDTH_PX,
  HIERARCHY_MAX_WIDTH_PX,
} from "./panels/resizablePanel.js";
import "./App.css";

export function App(): JSX.Element {
  // Fase 8 — un solo listener keydown per tutto l'editor (Delete/Ctrl+S/
  // Ctrl+O), montato qui perché queste scorciatoie non appartengono a un
  // pannello specifico (vedi JSDoc in shortcuts/globalShortcuts.ts).
  useGlobalEditorShortcuts();

  // Fase 9 — larghezza di Hierarchy draggabile (richiesta utente). Solo il
  // NUMERO vive in React state; il calcolo di clamp è puro e testato a sé
  // (resizablePanel.ts). `dragStateRef` (non state: cambia ad ogni pixel di
  // drag, non deve causare re-render) tiene il punto di partenza del drag
  // corrente — `null` quando non si sta trascinando.
  const [hierarchyWidth, setHierarchyWidth] = useState(HIERARCHY_DEFAULT_WIDTH_PX);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragStateRef.current = { startX: event.clientX, startWidth: hierarchyWidth };
    },
    [hierarchyWidth],
  );

  // Listener a livello di `document` (non sull'handle stesso): un drag
  // veloce può facilmente uscire dai 6px dell'handle mentre il mouse è
  // ancora premuto — stesso motivo per cui i menu popover del progetto
  // (hierarchy-add-menu, ContextMenu) ascoltano `document`, non se stessi.
  useEffect(() => {
    function onPointerMove(event: PointerEvent): void {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = event.clientX - dragState.startX;
      setHierarchyWidth(clampPanelWidth(dragState.startWidth + delta, HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MAX_WIDTH_PX));
    }
    function onPointerUp(): void {
      dragStateRef.current = null;
    }
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // Fase 9 — `--hierarchy-width` è una custom property CSS letta da
  // `.editor-body` in App.css (`grid-template-columns: var(--hierarchy-width, 220px) ...`):
  // un cast a CSSProperties serve solo perché il tipo di React non elenca
  // le custom property, il valore stesso è comunque un normale inline style.
  const editorBodyStyle = { "--hierarchy-width": `${hierarchyWidth}px` } as CSSProperties;

  return (
    <div className="editor-shell">
      <Topbar />
      <PwaUpdateBanner />
      <main className="editor-body" style={editorBodyStyle}>
        <Hierarchy />
        <Viewport />
        <Inspector />
        {/* Fase 9 — AssetsPanel dentro la grid di .editor-body (area
            "assets", fianco a fianco con Hierarchy nella riga inferiore):
            il Viewport occupa l'intera riga superiore, Inspector resta
            l'unica colonna a piena altezza — precisazione dell'utente
            rispetto a una versione precedente dove Hierarchy era a piena
            altezza come Inspector. */}
        <AssetsPanel />
        <div
          className="panel-resizer"
          style={{ left: hierarchyWidth }}
          onPointerDown={onResizerPointerDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Ridimensiona Hierarchy"
        />
      </main>
      <HostAgentPanel />
    </div>
  );
}
