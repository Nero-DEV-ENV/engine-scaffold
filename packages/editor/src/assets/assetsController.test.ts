import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetAssetPersistenceForTests, loadAsset } from "../persistence/AssetPersistence.js";
import { assetsStore } from "../store/editorStore.js";
import { detectAssetKind, importAssetFile, removeAsset, refreshAssets, getAssetObjectURL } from "./assetsController.js";

function makeFile(name: string, type: string, content = "contenuto"): File {
  return new File([content], name, { type });
}

describe("assetsController", () => {
  beforeEach(async () => {
    await _resetAssetPersistenceForTests();
    assetsStore.set([]);
  });

  describe("detectAssetKind", () => {
    it("riconosce .glb come model-gltf indipendentemente dal MIME riportato dal browser", () => {
      expect(detectAssetKind(makeFile("albero.glb", ""))).toBe("model-gltf");
    });

    it("riconosce .gltf come model-gltf", () => {
      expect(detectAssetKind(makeFile("scena.gltf", "model/gltf+json"))).toBe("model-gltf");
    });

    it("riconosce un'immagine PNG/JPG come texture dal MIME", () => {
      expect(detectAssetKind(makeFile("corteccia.png", "image/png"))).toBe("texture");
      expect(detectAssetKind(makeFile("foglia.jpg", "image/jpeg"))).toBe("texture");
    });

    it("restituisce null per un formato non supportato in questa fase (es. .fbx)", () => {
      expect(detectAssetKind(makeFile("personaggio.fbx", "application/octet-stream"))).toBeNull();
    });
  });

  describe("importAssetFile", () => {
    it("importa un modello valido, lo salva e aggiorna assetsStore", async () => {
      const meta = await importAssetFile(makeFile("albero.glb", "model/gltf-binary"));
      expect(meta).not.toBeNull();
      expect(meta?.kind).toBe("model-gltf");
      expect(meta?.name).toBe("albero.glb");

      expect(assetsStore.get()).toHaveLength(1);
      expect(assetsStore.get()[0]?.id).toBe(meta?.id);

      const stored = await loadAsset(meta!.id);
      expect(stored?.name).toBe("albero.glb");
    });

    it("assegna un MIME di fallback a un .glb senza File.type popolato dal browser", async () => {
      const meta = await importAssetFile(makeFile("albero.glb", ""));
      expect(meta?.mimeType).toBe("model/gltf-binary");
    });

    it("restituisce null e non scrive nulla per un formato non supportato", async () => {
      const meta = await importAssetFile(makeFile("personaggio.fbx", "application/octet-stream"));
      expect(meta).toBeNull();
      expect(assetsStore.get()).toEqual([]);
    });
  });

  describe("removeAsset", () => {
    it("rimuove l'asset e aggiorna assetsStore", async () => {
      const meta = await importAssetFile(makeFile("albero.glb", "model/gltf-binary"));
      await removeAsset(meta!.id);
      expect(assetsStore.get()).toEqual([]);
      await expect(loadAsset(meta!.id)).resolves.toBeNull();
    });
  });

  describe("refreshAssets", () => {
    it("ripopola assetsStore dallo stato corrente di IndexedDB", async () => {
      await importAssetFile(makeFile("albero.glb", "model/gltf-binary"));
      assetsStore.set([]);
      await refreshAssets();
      expect(assetsStore.get()).toHaveLength(1);
    });
  });

  describe("getAssetObjectURL", () => {
    it("restituisce null per un id inesistente", async () => {
      await expect(getAssetObjectURL("non-esiste")).resolves.toBeNull();
    });

    it("restituisce un object URL per un asset esistente", async () => {
      const meta = await importAssetFile(makeFile("albero.glb", "model/gltf-binary"));
      const url = await getAssetObjectURL(meta!.id);
      expect(url).toMatch(/^blob:/);
    });
  });
});
