import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameObject } from "@engine/core";
import type { SceneData } from "@engine/core";
import { _resetPersistenceForTests } from "../persistence/ScenePersistence.js";
import { sceneRootsStore, editorSceneHandleStore, saveLoadStatusStore, diskSaveLoadStatusStore } from "../store/editorStore.js";
import type { EditorSceneHandle } from "../scene/createEditorScene.js";
import { saveCurrentScene, loadPersistedSceneIntoEditor, saveSceneToDisk, loadSceneFromDiskIntoEditor, SCENE_FILE_NAME } from "./sceneActions.js";

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

  describe("saveSceneToDisk / loadSceneFromDiskIntoEditor (Fase 10F)", () => {
    // Nessun host-agent reale in questo ambiente di test: stesso stub
    // minimale di `globalThis.fetch` già usato da `importProjectFile`
    // (assets/assetsController.test.ts) — unica eccezione al pattern
    // "niente mock" del progetto, qui applicata a `writeProjectFile`/
    // `fetchProjectFile` (network/projectFolderClient.ts).
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      diskSaveLoadStatusStore.set({ kind: "idle" });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("saveSceneToDisk invia il JSON serializzato via writeProjectFile e porta lo status disco a success", async () => {
      sceneRootsStore.set([new GameObject("Cube")]);
      let receivedUrl = "";
      let receivedBody = "";
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        receivedUrl = url;
        receivedBody = init?.body as string;
        return new Response(null, { status: 200 });
      }) as typeof fetch;

      await saveSceneToDisk();

      expect(receivedUrl).toContain(`path=${encodeURIComponent(SCENE_FILE_NAME)}`);
      const sent = JSON.parse(receivedBody) as SceneData;
      expect(sent.roots[0]?.name).toBe("Cube");
      expect(diskSaveLoadStatusStore.get()).toEqual({ kind: "success", message: "Scena salvata su disco." });
      // saveLoadStatusStore (IndexedDB) resta indipendente — non toccato da questa azione.
      expect(saveLoadStatusStore.get()).toEqual({ kind: "idle" });
    });

    it("saveSceneToDisk porta lo status disco a error se la scrittura fallisce (nessuna project folder aperta)", async () => {
      globalThis.fetch = (async () => new Response(null, { status: 400 })) as typeof fetch;

      await saveSceneToDisk();

      expect(diskSaveLoadStatusStore.get().kind).toBe("error");
    });

    it("loadSceneFromDiskIntoEditor non fa nulla se l'handle non è ancora pronto", async () => {
      editorSceneHandleStore.set(null);

      await loadSceneFromDiskIntoEditor();

      expect(diskSaveLoadStatusStore.get()).toEqual({ kind: "idle" });
    });

    it("loadSceneFromDiskIntoEditor porta lo status disco a 'empty' se scene.json non esiste", async () => {
      editorSceneHandleStore.set(fakeHandle());
      globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;

      await loadSceneFromDiskIntoEditor();

      expect(diskSaveLoadStatusStore.get()).toEqual({ kind: "empty" });
    });

    it("loadSceneFromDiskIntoEditor scarica, deserializza e chiama loadScene con i dati", async () => {
      const sceneData: SceneData = { version: 1, roots: [] };
      globalThis.fetch = (async () =>
        new Response(new TextEncoder().encode(JSON.stringify(sceneData)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch;

      let calledWith: SceneData | null = null;
      editorSceneHandleStore.set(
        fakeHandle({
          loadScene: (data) => {
            calledWith = data;
          },
        }),
      );

      await loadSceneFromDiskIntoEditor();

      expect(calledWith).toEqual(sceneData);
      expect(diskSaveLoadStatusStore.get()).toEqual({ kind: "success", message: "Scena caricata da disco." });
    });

    it("loadSceneFromDiskIntoEditor porta lo status disco a error se il contenuto non è JSON valido", async () => {
      globalThis.fetch = (async () =>
        new Response(new TextEncoder().encode("non è json valido"), { status: 200 })) as typeof fetch;
      editorSceneHandleStore.set(fakeHandle());

      await loadSceneFromDiskIntoEditor();

      expect(diskSaveLoadStatusStore.get().kind).toBe("error");
    });
  });
});
