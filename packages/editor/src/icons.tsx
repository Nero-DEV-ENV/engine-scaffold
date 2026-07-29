/**
 * Fase 9 — icone SVG condivise, al posto dei precedenti bottoni testuali/a
 * glifo ("+", "×", "Save", "Load", "Importa") su richiesta esplicita
 * dell'utente. Tutte usano `currentColor` (ereditano il colore testo del
 * bottone che le contiene, coerente con la palette in scala di grigi —
 * `RemoveIcon` diventa rossa impostando `color` sul bottone, non qui) e
 * sono puramente decorative (`aria-hidden`, `focusable="false"`): il nome
 * accessibile del controllo resta sempre sul `<button>` che le ospita, via
 * `aria-label`/`title` — mai sull'icona stessa.
 */

const commonProps = {
  viewBox: "0 0 16 16",
  width: 16,
  height: 16,
  "aria-hidden": true,
  focusable: false,
} as const;

export function PlusIcon(): JSX.Element {
  return (
    <svg {...commonProps}>
      <path d="M8 2.5V13.5M2.5 8H13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function RemoveIcon(): JSX.Element {
  return (
    <svg {...commonProps}>
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function SaveIcon(): JSX.Element {
  return (
    <svg {...commonProps}>
      <path
        d="M3 3H11.5L13 4.5V13H3V3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5 3V6.5H10.5V3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 9.5H10.5V13" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Fase 10B — spostata qui da `panels/AssetsPanel.tsx` (dove nasceva in
 * Fase 9): il nuovo `panels/ProjectTree.tsx` deve mostrare la stessa icona
 * per i modelli glTF/GLB riconosciuti nell'albero, coerenza col
 * linguaggio visivo già in uso nella lista Assets.
 */
export function ModelIcon(): JSX.Element {
  return (
    <svg {...commonProps}>
      <path
        d="M8 1.2 14 4.6V11.4L8 14.8 2 11.4V4.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M2 4.6 8 8 14 4.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 8 8 14.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** Fase 10B — cartella nell'albero navigabile del Project panel (`panels/ProjectTree.tsx`). */
export function FolderIcon(): JSX.Element {
  return (
    <svg {...commonProps}>
      <path
        d="M1.5 4.2C1.5 3.6 2 3.1 2.6 3.1H6L7.3 4.4H13.4C14 4.4 14.5 4.9 14.5 5.5V11.4C14.5 12 14 12.5 13.4 12.5H2.6C2 12.5 1.5 12 1.5 11.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Fase 10B — file generico (nessun tipo riconosciuto) nell'albero navigabile del Project panel. */
export function FileIcon(): JSX.Element {
  return (
    <svg {...commonProps}>
      <path
        d="M3.5 1.5H9.5L12.5 4.5V14.5H3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.5 1.5V4.5H12.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function LoadIcon(): JSX.Element {
  return (
    <svg {...commonProps}>
      <path
        d="M2 5C2 4.4 2.4 4 3 4H6L7.2 5.4H13C13.6 5.4 14 5.8 14 6.4V11.5C14 12.1 13.6 12.5 13 12.5H3C2.4 12.5 2 12.1 2 11.5V5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
