import { useEffect } from "react";
import { selectionStore, editorSceneHandleStore, saveLoadStatusStore, activeToolStore, type EditorTool } from "../store/editorStore.js";
import { saveCurrentScene, loadPersistedSceneIntoEditor } from "../actions/sceneActions.js";

/**
 * Fase 8 — scorciatoie da tastiera globali, punto aperto 1: solo le tre
 * confermate per quella fase (le altre candidate del documento di
 * continuazione — Ctrl+D duplica, nudge con le frecce — non erano in scope
 * lì, vedi roadmap Fase 8A/8B/8C).
 *
 * Fase 8A aggiunge Ctrl/Cmd+D — Duplica GameObject selezionato, isolata
 * dalle altre candidate di Fase 8B (vedi `EditorSceneHandle.duplicateGameObject`
 * in scene/createEditorScene.ts per la logica di duplicazione vera e propria;
 * qui solo il riconoscimento della combinazione tasto+stato, stesso stile di
 * Delete/Ctrl+S/Ctrl+O sotto).
 *
 * - Delete (Canc): elimina il GameObject selezionato. Stesso identico
 *   metodo `EditorSceneHandle.removeGameObject` già usato dal bottone
 *   "Elimina" di Inspector.tsx (punto aperto 6) — nessuna logica di lock
 *   nuova qui: il vincolo "bloccato se lockato da un ALTRO client" è
 *   interamente server-side (EditorRoom.ts, deciso in Fase 6C.2), quindi
 *   questa scorciatoia eredita lo STESSO comportamento del bottone
 *   Inspector senza replicare alcun controllo lato client.
 * - Ctrl/Cmd+S: salva la scena — stesso identico shortcut di Unity
 *   (Save Scene). `preventDefault()` sempre, per sopprimere il "Salva
 *   pagina" nativo del browser.
 * - Ctrl/Cmd+O: carica la scena persistita — corrisponde a "Open Scene" in
 *   Unity. Qui il progetto ha un solo slot IndexedDB (non un vero file
 *   picker), quindi il corrispettivo più fedele è il bottone "Load"
 *   esistente. `preventDefault()` sempre, per sopprimere "Apri file"
 *   nativo del browser.
 * - Ctrl/Cmd+D (Fase 8A): duplica il GameObject selezionato — stesso
 *   identico shortcut di Unity (Duplicate). Richiede selezione e handle
 *   pronto, stessa condizione di Delete — a differenza di Delete però non
 *   controlla `targetIsEditable`: Ctrl+D non tocca il contenuto testuale di
 *   nessun campo (stesso ragionamento già fatto per Ctrl+S/Ctrl+O sotto),
 *   quindi scatta anche a focus su un campo editabile.
 * - F (Fase 8B): ricentra la camera sul GameObject selezionato — vedi
 *   `EditorSceneHandle.focusOnGameObject`. Richiede selezione+handle come
 *   Delete/Ctrl+D, ma A DIFFERENZA di Ctrl+D controlla `targetIsEditable`
 *   (nessun modificatore: la sola lettera "f" scriverebbe altrimenti nei
 *   campi di testo, esattamente come Q/W/E/R sotto).
 * - Q/W/E/R (Fase 8B): cambiano il tool attivo del Viewport (Hand/Move/
 *   Rotate/Scale, `activeToolStore` in store/editorStore.ts) — non
 *   richiedono selezione/handle (sono una preferenza UI, non un'azione sulla
 *   scena), ma comunque esclusi su `targetIsEditable` per lo stesso motivo
 *   di F sopra.
 *
 * Delete viene ignorato quando il focus è su un campo di testo editabile
 * (input/textarea/contentEditable) — altrimenti cancellare del testo nel
 * campo "Il tuo nome" di Topbar.tsx o in un campo numerico dell'Inspector
 * eliminerebbe anche il GameObject selezionato. Ctrl+S/Ctrl+O/Ctrl+D invece
 * scattano SEMPRE, anche a campo di testo focheggiato: non toccano il
 * contenuto del campo (a differenza di Delete), e sopprimere il
 * comportamento nativo del browser (Salva pagina/Apri file/Aggiungi ai
 * preferiti) è necessario ovunque, non solo fuori dai campi.
 *
 * `resolveShortcutAction` sotto contiene TUTTA la logica decisionale (quale
 * azione, se una, una data combinazione di tasti/stato dovrebbe innescare)
 * come funzione pura su soli primitivi — nessun `KeyboardEvent`/
 * `HTMLElement` in ingresso. Separata deliberatamente da
 * `useGlobalEditorShortcuts` sotto (che legge il vero `KeyboardEvent`/
 * `document.activeElement` e chiama i veri store/azioni): questo progetto
 * testa la logica pura e lascia non testato il collegamento sottile a
 * React/DOM, stessa scelta già motivata in store/editorStore.test.ts per
 * `useValue()` (wrapper sottile su API nativa, non giustifica una
 * dipendenza di test nuova come @testing-library/react — ci vorrebbe qui
 * per montare un componente e dispatchare un vero KeyboardEvent). Vedi
 * shortcuts/globalShortcuts.test.ts.
 */
export type ShortcutAction =
  | { kind: "save" }
  | { kind: "load" }
  | { kind: "delete" }
  | { kind: "duplicate" }
  | { kind: "focus" }
  | { kind: "setTool"; tool: EditorTool }
  | null;

export interface ShortcutInput {
  key: string;
  ctrlOrCmd: boolean;
  targetIsEditable: boolean;
  hasSelection: boolean;
  hasHandle: boolean;
  saveLoadBusy: boolean;
}

export function resolveShortcutAction(input: ShortcutInput): ShortcutAction {
  const { key, ctrlOrCmd, targetIsEditable, hasSelection, hasHandle, saveLoadBusy } = input;
  const lowerKey = key.toLowerCase();

  if (ctrlOrCmd && lowerKey === "s") {
    return hasHandle && !saveLoadBusy ? { kind: "save" } : null;
  }
  if (ctrlOrCmd && lowerKey === "o") {
    return hasHandle && !saveLoadBusy ? { kind: "load" } : null;
  }
  if (ctrlOrCmd && lowerKey === "d") {
    return hasSelection && hasHandle ? { kind: "duplicate" } : null;
  }
  if (key === "Delete" && !targetIsEditable) {
    return hasSelection && hasHandle ? { kind: "delete" } : null;
  }
  // Fase 8B — F/Q/W/E/R: tasti senza modificatore, quindi esclusi mentre il
  // focus è su un campo di testo editabile (stesso motivo di Delete: altrimenti
  // scrivere "quadro" nel campo nome cambierebbe tool ad ogni lettera Q/W/E/R
  // digitata). Ctrl/Cmd escluso a priori: quelle combinazioni sono già gestite
  // sopra (S/O/D) o riservate a future scorciatoie (Ctrl+Z/Ctrl+P).
  if (!ctrlOrCmd && !targetIsEditable) {
    if (lowerKey === "f") {
      return hasSelection && hasHandle ? { kind: "focus" } : null;
    }
    if (lowerKey === "q") {
      return { kind: "setTool", tool: "hand" };
    }
    if (lowerKey === "w") {
      return { kind: "setTool", tool: "move" };
    }
    if (lowerKey === "e") {
      return { kind: "setTool", tool: "rotate" };
    }
    if (lowerKey === "r") {
      return { kind: "setTool", tool: "scale" };
    }
  }
  return null;
}

/**
 * `true` per un elemento che intercetta l'input testuale dell'utente
 * (input/textarea/select/contentEditable) — Delete deve essere ignorato lì
 * (vedi JSDoc sopra), Ctrl+S/Ctrl+O invece no. Richiede `HTMLElement` reale
 * (browser); non testato direttamente per lo stesso motivo di
 * `resolveShortcutAction` sopra — è wiring DOM, non logica.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Un solo listener `keydown` su `document`, montato una volta sola in
 * App.tsx (non per-pannello): Delete/Ctrl+S/Ctrl+O sono azioni
 * dell'EDITOR, non di uno specifico pannello — a differenza del menu
 * contestuale (Fase 8, ma diverso: quello dipende da DOVE si è cliccato).
 */
export function useGlobalEditorShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const ctrlOrCmd = event.ctrlKey || event.metaKey;
      const action = resolveShortcutAction({
        key: event.key,
        ctrlOrCmd,
        targetIsEditable: isEditableTarget(event.target),
        hasSelection: selectionStore.get() !== null,
        hasHandle: editorSceneHandleStore.get() !== null,
        saveLoadBusy: saveLoadStatusStore.get().kind === "busy",
      });

      // Ctrl+S/Ctrl+O/Ctrl+D sopprimono sempre il comportamento nativo del
      // browser, ANCHE quando `resolveShortcutAction` decide di non agire
      // (es. saveLoadBusy per S/O, nessuna selezione per D): altrimenti,
      // durante un salvataggio già in corso, un secondo Ctrl+S aprirebbe
      // comunque il dialog "Salva pagina" nativo invece di essere
      // silenziosamente ignorato — stesso discorso per Ctrl+D e "Aggiungi
      // ai preferiti". Delete va invece soppresso solo quando l'azione
      // scatta davvero (nessun motivo di intercettarlo se non c'è
      // selezione: non esiste un comportamento nativo del browser da
      // sopprimere per il solo tasto Delete fuori da un campo di testo).
      const lowerKey = event.key.toLowerCase();
      if (ctrlOrCmd && (lowerKey === "s" || lowerKey === "o" || lowerKey === "d")) {
        event.preventDefault();
      }

      if (!action) return;

      switch (action.kind) {
        case "save":
          void saveCurrentScene();
          break;
        case "load":
          void loadPersistedSceneIntoEditor();
          break;
        case "duplicate": {
          const selected = selectionStore.get();
          const handle = editorSceneHandleStore.get();
          if (selected && handle) {
            handle.duplicateGameObject(selected);
          }
          break;
        }
        case "focus": {
          const selected = selectionStore.get();
          const handle = editorSceneHandleStore.get();
          if (selected && handle) {
            handle.focusOnGameObject(selected);
          }
          break;
        }
        case "setTool":
          activeToolStore.set(action.tool);
          break;
        case "delete": {
          const selected = selectionStore.get();
          const handle = editorSceneHandleStore.get();
          if (selected && handle) {
            event.preventDefault();
            handle.removeGameObject(selected);
          }
          break;
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
