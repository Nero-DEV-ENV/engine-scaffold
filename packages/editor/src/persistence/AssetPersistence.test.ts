import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  saveAsset,
  loadAsset,
  listAssets,
  deleteAsset,
  _resetAssetPersistenceForTests,
  type AssetRecord,
} from "./AssetPersistence.js";

/** Vedi il commento su `import "fake-indexeddb/auto"` in ScenePersistence.test.ts: stesso motivo, stesso posizionamento in cima al file. */

function makeAssetRecord(overrides?: Partial<AssetRecord>): AssetRecord {
  return {
    id: "asset-1",
    name: "albero.glb",
    kind: "model-gltf",
    mimeType: "model/gltf-binary",
    data: new Uint8Array([1, 2, 3, 4]).buffer,
    ...overrides,
  };
}

describe("AssetPersistence", () => {
  beforeEach(async () => {
    await _resetAssetPersistenceForTests();
  });

  it("loadAsset restituisce null per un id mai salvato", async () => {
    await expect(loadAsset("non-esiste")).resolves.toBeNull();
  });

  it("listAssets restituisce un array vuoto quando non è stato importato nessun asset", async () => {
    await expect(listAssets()).resolves.toEqual([]);
  });

  it("round-trip: un asset salvato viene ricaricato identico (payload incluso)", async () => {
    const record = makeAssetRecord();
    await saveAsset(record);
    await expect(loadAsset(record.id)).resolves.toEqual(record);
  });

  it("listAssets restituisce solo i metadati, senza il payload binario", async () => {
    await saveAsset(makeAssetRecord());
    const list = await listAssets();
    expect(list).toEqual([{ id: "asset-1", name: "albero.glb", kind: "model-gltf", mimeType: "model/gltf-binary" }]);
  });

  it("listAssets elenca più asset di kind diversi", async () => {
    await saveAsset(makeAssetRecord({ id: "asset-1", kind: "model-gltf" }));
    await saveAsset(makeAssetRecord({ id: "asset-2", name: "corteccia.png", kind: "texture", mimeType: "image/png" }));
    const list = await listAssets();
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.id).sort()).toEqual(["asset-1", "asset-2"]);
  });

  it("saveAsset con lo stesso id sovrascrive il record precedente", async () => {
    await saveAsset(makeAssetRecord({ name: "vecchio.glb" }));
    await saveAsset(makeAssetRecord({ name: "nuovo.glb" }));
    const record = await loadAsset("asset-1");
    expect(record?.name).toBe("nuovo.glb");
  });

  it("deleteAsset rimuove l'asset", async () => {
    await saveAsset(makeAssetRecord());
    await deleteAsset("asset-1");
    await expect(loadAsset("asset-1")).resolves.toBeNull();
    await expect(listAssets()).resolves.toEqual([]);
  });

  it("deleteAsset su un id inesistente è un no-op silenzioso", async () => {
    await expect(deleteAsset("non-esiste")).resolves.toBeUndefined();
  });

  it("_resetAssetPersistenceForTests pulisce davvero lo stato fra un test e l'altro", async () => {
    await saveAsset(makeAssetRecord());
    await _resetAssetPersistenceForTests();
    await expect(listAssets()).resolves.toEqual([]);
  });
});
