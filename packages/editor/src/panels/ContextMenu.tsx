import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}

/**
 * Fase 8 — popup generico posizionato a coordinate di schermo (`x`/`y`,
 * tipicamente `event.clientX`/`event.clientY` dell'evento `contextmenu`
 * che lo ha aperto), usato sia da Hierarchy.tsx (righe/area vuota) sia da
 * Viewport.tsx (oggetto colpito da raycast/area vuota) — stesso identico
 * pattern "chiudi al click fuori" già usato dal menu "+" di Hierarchy.tsx
 * (`hierarchy-add-menu`), qui generalizzato in un componente a sé perché
 * ora serve in due pannelli diversi che non condividono altrimenti alcuno
 * stato. `position: fixed` (non `absolute`): `x`/`y` sono coordinate di
 * VIEWPORT (da `event.clientX/Y`), non relative a un antenato posizionato.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    // Stesso identificatore di problema del menu "+" di Hierarchy.tsx: un
    // singolo click che ha aperto QUESTO popup (pointerdown del
    // contextmenu stesso, sul tasto destro) non deve richiuderlo subito —
    // ma qui il popup nasce già aperto dall'evento `contextmenu`, non da un
    // click successivo, quindi non serve alcuna guardia sul primo evento:
    // il `pointerdown` del tasto destro che ha generato il menu è già
    // passato quando questo effect si registra.
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <ul className="context-menu" style={{ position: "fixed", left: x, top: y }} ref={menuRef}>
      {items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            className="context-menu-option"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
