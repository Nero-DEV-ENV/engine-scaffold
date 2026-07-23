import { useSyncExternalStore } from "react";
import type { GameObject } from "@engine/core";
import type { EditorSceneHandle } from "../scene/createEditorScene.js";

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
