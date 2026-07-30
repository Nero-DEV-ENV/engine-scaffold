import { useSyncExternalStore } from "react";
import type { GameObject } from "@engine/core";
import type { EditorSceneHandle } from "../scene/createEditorScene.js";
import type { AssetMeta } from "../persistence/AssetPersistence.js";

/**
 * editorStore.ts — store esterno minimale condiviso fra codice
 * imperativo three.js (createEditorScene.ts, fuori da qualunque
 * componente React) e i pannelli React fratelli (Hierarchy/Viewport/
 * Inspector) che non condividono un antenato comune sotto cui mettere
 * uno `useState`.
 *
 * Un React Context risolverebbe solo la condivisione fra componenti
 * React: non aiuterebbe `createEditorScene.ts` a leggere/scrivere la
 * selezione da un listener di click sul canvas, che gira fuori da
 * qualunque albero React. `useSyncExternalStore` è nativo di React 18
 * (già dependency da Fase 4A): zero dipendenze nuove.
 *
 * Esportata da Fase 6B.client-1: network/collabClient.ts la riusa per
 * connectionStore (stato di connessione Colyseus, a fasi/asincrono) invece
 * di reimplementare lo stesso identico factory.
 */
export function createExternalStore<T>(initialValue: T) {
  let value = initialValue;
  const listeners = new Set<() => void>();

  function get(): T {
    return value;
  }

  function set(nextValue: T): void {
    if (Object.is(value, nextValue)) return;
    value = nextValue;
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function useValue(): T {
    return useSyncExternalStore(subscribe, get);
  }

  return { get, set, subscribe, useValue };
}

/** GameObject attualmente selezionato (click su una riga Hierarchy o raycast dal Viewport), o null se nessuna selezione. */
export const selectionStore = createExternalStore<GameObject | null>(null);

/**
 * GameObject radice della scena corrente, nell'ordine in cui Hierarchy
 * deve elencarli. Popolato da Viewport.tsx quando `createEditorScene`
 * risolve (vedi `EditorSceneHandle.roots`), svuotato al dispose.
 */
export const sceneRootsStore = createExternalStore<readonly GameObject[]>([]);

/**
 * L'`EditorSceneHandle` corrente (Fase 5B), o null se il Viewport non ha
 * ancora finito il bootstrap/è smontato. Serve perché la Topbar (sibling di
 * Viewport in App.tsx, per il bottone Save/Load) non condivide alcun
 * antenato React con `createEditorScene.ts` da cui ricevere l'handle in
 * altro modo — stesso motivo già alla base di `selectionStore`/
 * `sceneRootsStore`, qui applicato all'handle stesso invece che a un suo
 * singolo campo.
 */
export const editorSceneHandleStore = createExternalStore<EditorSceneHandle | null>(null);

/**
 * Contatore bumpato ad ogni modifica del Transform del GameObject
 * attualmente selezionato — sia dal drag del gizmo nel Viewport (evento
 * "objectChange" di TransformControls, vedi createEditorScene.ts) sia dalla
 * modifica di un campo numerico in Inspector.tsx (Fase 4C).
 *
 * Necessario perché `Transform.position/eulerAngles/localScale` sono
 * istanze THREE.Vector3/Euler mutate in place (`Object3D.position.set()`
 * ecc.): mutarle non genera di per sé alcun re-render React. Senza questo
 * contatore, l'Inspector non saprebbe che i valori mostrati sono stale
 * mentre l'utente trascina il gizmo (il gizmo stesso non ha bisogno di
 * leggere questo store: segue l'Object3D selezionato direttamente ad ogni
 * frame del loop di rendering, non passa dai campi Inspector).
 */
export const transformVersionStore = createExternalStore<number>(0);

/** Incrementa `transformVersionStore` — da chiamare dopo ogni scrittura sul Transform del GameObject selezionato. */
export function bumpTransformVersion(): void {
  transformVersionStore.set(transformVersionStore.get() + 1);
}

/**
 * Fase 7 — metadati (senza payload binario, vedi AssetPersistence.ts) di
 * tutti gli asset importati correnti. Popolato da
 * `assets/assetsController.ts` (import/refresh/rimozione), letto da
 * AssetsPanel.tsx — stesso motivo di `sceneRootsStore` sopra: nessun
 * antenato React comune fra il controller (chiamato anche da fuori React,
 * es. al bootstrap del Viewport) e il pannello.
 */
export const assetsStore = createExternalStore<readonly AssetMeta[]>([]);

/**
 * Fase 8 — stato dell'ultima azione Save/Load, condiviso fra Topbar.tsx
 * (bottoni) e shortcuts/globalShortcuts.ts (Ctrl+S/Ctrl+O da tastiera):
 * prima di questa fase `Status` viveva come `useState` locale a Topbar.tsx,
 * ma un salvataggio/caricamento innescato da tastiera deve mostrare lo
 * stesso feedback testuale di uno innescato dal bottone — da cui
 * l'estrazione qui, stesso motivo di `editorSceneHandleStore` sopra
 * (due punti d'ingresso diversi verso la stessa azione, nessun antenato
 * React comune da cui condividere altrimenti uno stato locale). Le
 * funzioni che aggiornano questo store (`saveCurrentScene`/
 * `loadPersistedSceneIntoEditor`) vivono in `actions/sceneActions.ts`.
 */
export type SaveLoadStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export const saveLoadStatusStore = createExternalStore<SaveLoadStatus>({ kind: "idle" });

/**
 * Fase 10F — stato dell'ultima azione Salva/Carica su DISCO (dentro la
 * project folder), separato da `saveLoadStatusStore` sopra (IndexedDB):
 * punto 1 confermato dall'utente, le due azioni sono parallele e
 * indipendenti, non un'unica azione condivisa — un salvataggio su disco non
 * deve sovrascrivere/confondersi col messaggio dell'ultimo salvataggio
 * IndexedDB mostrato in Topbar.tsx, e viceversa. Stessa shape (`SaveLoadStatus`,
 * riusato) perché il significato dei 5 stati è identico, solo il
 * meccanismo di persistenza sottostante cambia.
 */
export const diskSaveLoadStatusStore = createExternalStore<SaveLoadStatus>({ kind: "idle" });

/**
 * Fase 8B — tool attivo nel Viewport, stile barra strumenti di Unity
 * (Q/W/E/R): `"move"`/`"rotate"`/`"scale"` corrispondono 1:1 alle modalità
 * `"translate"/"rotate"/"scale"` di `TransformControls` (createEditorScene.ts
 * traduce il nome), `"hand"` nasconde/disabilita il gizmo di trasformazione
 * senza deselezionare l'oggetto (stesso comportamento distintivo dello
 * strumento Hand di Unity: nessuna maniglia di manipolazione visibile).
 * Default `"move"`: stessa modalità già hardcoded di `TransformControls`
 * prima di questa fase, quindi introdurre questo store non cambia il
 * comportamento di default esistente.
 */
export type EditorTool = "hand" | "move" | "rotate" | "scale";

export const activeToolStore = createExternalStore<EditorTool>("move");
