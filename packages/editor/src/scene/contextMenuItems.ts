import type { GameObject } from "@engine/core";
import type { EditorSceneHandle } from "./createEditorScene.js";
import type { ContextMenuItem } from "../panels/ContextMenu.js";
import { ADD_GAME_OBJECT_OPTIONS } from "./addOptions.js";

/**
 * Fase 8 — costruisce le voci del menu contestuale per Hierarchy.tsx e
 * Viewport.tsx: stesse identiche azioni in entrambi i pannelli (punto
 * aperto 2 confermato dall'utente), quindi centralizzate qui invece di
 * duplicare la costruzione della lista in due componenti.
 *
 * `target` è il GameObject su cui si è fatto click destro (già selezionato
 * dal chiamante PRIMA di costruire il menu — punto aperto 4: un click
 * destro seleziona sempre l'oggetto sotto il cursore), oppure `null` se il
 * click destro ha colpito un'area vuota (riga assente in Hierarchy,
 * nessun hit dal raycast in Viewport) — stesso identico significato di
 * `null` già usato da `selectionStore` per "nessuna selezione".
 *
 * `handle` può essere `null` durante il bootstrap del Viewport (stesso
 * gate già usato altrove, es. Topbar.tsx): le azioni diventano dei no-op
 * silenziosi invece di lanciare, coerente con `onDelete`/`onAdd` già
 * esistenti in Inspector.tsx/Hierarchy.tsx.
 *
 * Fase 8A (duplicazione, Ctrl+D) aggiungerà qui una voce "Duplica" quando
 * `target` non è null — non prima, perché `EditorSceneHandle` non ha
 * ancora un metodo di duplicazione (verificato in fase di bugcheck).
 */
export function buildSceneContextMenuItems(
  target: GameObject | null,
  handle: EditorSceneHandle | null,
): ContextMenuItem[] {
  if (target) {
    return [
      {
        label: "Elimina",
        onSelect: () => handle?.removeGameObject(target),
      },
    ];
  }
  return ADD_GAME_OBJECT_OPTIONS.map((option) => ({
    label: option.label,
    onSelect: () => {
      handle?.addGameObject(option.kind);
    },
  }));
}
