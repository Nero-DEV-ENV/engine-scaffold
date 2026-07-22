import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SceneData } from "@engine/core";
import { saveScene, loadScene, _resetPersistenceForTests } from "./ScenePersistence.js";

/**
 * `import "fake-indexeddb/auto"` deve stare PRIMA di ogni altro import che
 * tocchi `idb`/`indexedDB`: patcha `globalThis.indexedDB`/`IDBKeyRange` con
 * un'implementazione in memoria — Node/Vitest qui gira senza `environment:
 * jsdom` (verificato: nessun `indexedDB` nativo in Node 22), quindi senza
 * questo polyfill `openDB` fallirebbe subito.
 */

function makeSceneData(overrides?: Partial<SceneData>): SceneData {
  return {
    version: 1,
    roots: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Cube",
        active: true,
        transform: {
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        components: [
          { type: "MeshRenderer", shape: { kind: "box", size: { x: 1, y: 1, z: 1 } }, color: 0x4f8ef7 },
        ],
        children: [],
      },
    ],
    ...overrides,
  };
}

describe("ScenePersistence", () => {
  beforeEach(async () => {
    await _resetPersistenceForTests();
  });

  it("loadScene restituisce null quando non è mai stata salvata nessuna scena", async () => {
    await expect(loadScene()).resolves.toBeNull();
  });

  it("round-trip: una scena salvata viene ricaricata identica", async () => {
    const data = makeSceneData();
    await saveScene(data);
    await expect(loadScene()).resolves.toEqual(data);
  });

  it("saveScene sovrascrive lo slot unico invece di accumulare scene", async () => {
    await saveScene(makeSceneData());
    const second = makeSceneData({ roots: [] });
    await saveScene(second);
    await expect(loadScene()).resolves.toEqual(second);
  });

  it("_resetPersistenceForTests pulisce davvero lo stato fra un test e l'altro", async () => {
    await saveScene(makeSceneData());
    await _resetPersistenceForTests();
    await expect(loadScene()).resolves.toBeNull();
  });
});
