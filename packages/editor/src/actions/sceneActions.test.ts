import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { GameObject } from "@engine/core";
import type { SceneData } from "@engine/core";
import { _resetPersistenceForTests } from "../persistence/ScenePersistence.js";
import { sceneRootsStore, editorSceneHandleStore, saveLoadStatusStore } from "../store/editorStore.js";
import type { EditorSceneHandle } from "../scene/createEditorScene.js";
import { saveCurrentScene, loadPersistedSceneIntoEditor } from "./sceneActions.js";

/**
 * Stesso motivo di `fake-indexeddb/auto` in ScenePersistence.test.ts: qui
 * gira senza `environment: jsdom`, quindi senza il polyfill `openDB`
 * fallirebbe. `saveCurrentScene`/`loadPersistedSceneIntoEditor` sono
 * un'orchestrazione sottile sopra ScenePersistence.ts (già testato lì) +
 * `saveLoadStatusStore`: quello che manca da testare qui è che lo stato
 * condiviso transiti correttamente — non la persistenza stessa.
 */
function fakeHandle(overrides?: Partial<EditorSceneHandle>): EditorSceneHandle {
  return { loadScene: () => {}, ...overrides } as unknown as EditorSceneHandle;
}

describe("sceneActions", () => {
  beforeEach(async () => {
    await _resetPersistenceForTests();
    sceneRootsStore.set([]);
    editorSceneHandleStore.set(null);
    saveLoadStatusStore.set({ kind: "idle" });
  });

  describe("saveCurrentScene", () => {
    it("salva i roots correnti e porta lo status a success", async () => {
      sceneRootsStore.set([new GameObject("Cube")]);

      await saveCurrentScene();

      const status = saveLoadStatusStore.get();
      expect(status).toEqual({ kind: "success", message: "Scena salvata." });
    });

    it("il round-trip tramite loadPersistedSceneIntoEditor ritrova lo stesso nome salvato", async () => {
      sceneRootsStore.set([new GameObject("Cube")]);
      await saveCurrentScene();

      let loadedData: SceneData | null = null;
      const handle = fakeHandle({
        loadScene: (data) => {
          loadedData = data;
        },
      });
      editorSceneHandleStore.set(handle);

      await loadPersistedSceneIntoEditor();

      expect(loadedData).not.toBeNull();
      expect(loadedData!.roots[0]?.name).toBe("Cube");
    });
  });

  describe("loadPersistedSceneIntoEditor", () => {
    it("non fa nulla se l'handle non è ancora pronto (bootstrap Viewport)", async () => {
      editorSceneHandleStore.set(null);

      await loadPersistedSceneIntoEditor();

      // Nessuna transizione di stato: l'azione è un no-op silenzioso,
      // stesso trattamento del bottone Load esistente (`if (!handle) return;`).
      expect(saveLoadStatusStore.get()).toEqual({ kind: "idle" });
    });

    it("porta lo status a 'empty' se non c'è nulla di persistito", async () => {
      editorSceneHandleStore.set(fakeHandle());

      await loadPersistedSceneIntoEditor();

      expect(saveLoadStatusStore.get()).toEqual({ kind: "empty" });
    });

    it("chiama EditorSceneHandle.loadScene con i dati persistiti e porta lo status a success", async () => {
      sceneRootsStore.set([new GameObject("Sphere")]);
      await saveCurrentScene();

      let calledWith: SceneData | null = null;
      editorSceneHandleStore.set(
        fakeHandle({
          loadScene: (data) => {
            calledWith = data;
          },
        }),
      );

      await loadPersistedSceneIntoEditor();

      expect(calledWith).not.toBeNull();
      expect(calledWith!.roots[0]?.name).toBe("Sphere");
      expect(saveLoadStatusStore.get()).toEqual({ kind: "success", message: "Scena caricata." });
    });
  });
});
