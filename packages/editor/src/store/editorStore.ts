import { useSyncExternalStore } from "react";
import type { GameObject } from "@engine/core";

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
 */
function createExternalStore<T>(initialValue: T) {
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
