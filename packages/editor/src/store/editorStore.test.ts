import { describe, it, expect, beforeEach } from "vitest";
import { selectionStore, sceneRootsStore } from "./editorStore.js";
import type { GameObject } from "@engine/core";

/**
 * `selectionStore`/`sceneRootsStore` sono singleton a livello di modulo
 * (stesso pattern, e stessa motivazione, del registry di Scene.ts nel
 * core): li resettiamo esplicitamente prima di ogni test per tenerli
 * isolati fra un test e l'altro nello stesso file. `useValue()` (il solo
 * hook React di questo modulo) non è testato qui: è un wrapper di due
 * righe attorno a `useSyncExternalStore` nativo di React, già testato da
 * React stesso — verificarlo richiederebbe @testing-library/react-hooks,
 * una dipendenza nuova non giustificata per coprire due righe di delega.
 */
beforeEach(() => {
  selectionStore.set(null);
  sceneRootsStore.set([]);
});

function fakeGameObject(name: string): GameObject {
  return { name } as unknown as GameObject;
}

describe("selectionStore", () => {
  it("get() restituisce null di default", () => {
    expect(selectionStore.get()).toBeNull();
  });

  it("set() aggiorna il valore letto da get()", () => {
    const go = fakeGameObject("Cube");
    selectionStore.set(go);
    expect(selectionStore.get()).toBe(go);
  });

  it("subscribe() notifica i listener quando il valore cambia, non più dopo unsubscribe()", () => {
    const go = fakeGameObject("Cube");
    let notifications = 0;
    const unsubscribe = selectionStore.subscribe(() => {
      notifications++;
    });

    selectionStore.set(go);
    expect(notifications).toBe(1);

    unsubscribe();
    selectionStore.set(null);
    expect(notifications).toBe(1);
  });

  it("set() con lo stesso riferimento (Object.is) non notifica i listener", () => {
    const go = fakeGameObject("Cube");
    selectionStore.set(go);

    let notifications = 0;
    const unsubscribe = selectionStore.subscribe(() => {
      notifications++;
    });

    selectionStore.set(go);
    expect(notifications).toBe(0);

    unsubscribe();
  });
});

describe("sceneRootsStore", () => {
  it("get() restituisce un array vuoto di default", () => {
    expect(sceneRootsStore.get()).toEqual([]);
  });

  it("set() aggiorna i root letti da get()", () => {
    const roots = [fakeGameObject("Ground"), fakeGameObject("Cube")];
    sceneRootsStore.set(roots);
    expect(sceneRootsStore.get()).toBe(roots);
  });
});

describe("selectionStore e sceneRootsStore sono indipendenti", () => {
  it("un set() su uno store non notifica i listener dell'altro", () => {
    let selectionNotifications = 0;
    let rootsNotifications = 0;
    const unsubscribeSelection = selectionStore.subscribe(() => selectionNotifications++);
    const unsubscribeRoots = sceneRootsStore.subscribe(() => rootsNotifications++);

    selectionStore.set(fakeGameObject("Sphere"));

    expect(selectionNotifications).toBe(1);
    expect(rootsNotifications).toBe(0);

    unsubscribeSelection();
    unsubscribeRoots();
  });
});
