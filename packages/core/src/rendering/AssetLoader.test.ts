import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { setTextureResolver, requestTexture, invalidateTexture } from "./AssetLoader.js";

/**
 * AssetLoader.test.ts — Fase 11B.2: copre `invalidateTexture` (11B.1
 * aveva `requestTexture`/`releaseTexture` testati solo indirettamente via
 * MeshRenderer, nessun test dedicato a questo file). Il caso qui coperto
 * è un bug reale scoperto in smoke-test (non nel documento originale):
 * senza un cache-buster nell'URL di ricaricamento, il browser serve i
 * byte vecchi dalla propria cache HTTP per la stessa URL, e
 * l'invalidazione "riesce" silenziosamente restituendo la texture di
 * prima — nessun errore, solo un comportamento sbagliato, per questo
 * serve un test che verifichi esplicitamente l'URL passata al loader,
 * non solo che la Promise si risolva.
 */
describe("invalidateTexture", () => {
  beforeEach(() => {
    setTextureResolver((path) => `https://example.test/project/file?path=${path}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ricarica con un URL diverso da quella originale (cache-buster), per bypassare la cache HTTP del browser", async () => {
    const loadSpy = vi.spyOn(THREE.TextureLoader.prototype, "load").mockImplementation(function (
      this: THREE.TextureLoader,
      _url: string,
      onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void
    ) {
      const texture = new THREE.Texture<HTMLImageElement>();
      onLoad?.(texture);
      return texture;
    });

    const pending = requestTexture("wood.png");
    expect(pending).not.toBeNull();
    await pending;

    const originalUrl = loadSpy.mock.calls[0]![0] as string;
    loadSpy.mockClear();

    invalidateTexture("wood.png");

    expect(loadSpy).toHaveBeenCalledTimes(1);
    const reloadUrl = loadSpy.mock.calls[0]![0] as string;

    // Stesso percorso base (stesso resolver), ma URL EFFETTIVAMENTE
    // diversa da quella originale — altrimenti il browser potrebbe
    // servire una risposta cache dalla richiesta iniziale.
    expect(reloadUrl).not.toBe(originalUrl);
    expect(reloadUrl.startsWith("https://example.test/project/file?path=wood.png")).toBe(true);
    expect(reloadUrl).toMatch(/[?&]_invalidatedAt=\d+/);
  });

  it("non ricarica nulla (no-op) se il percorso non è in cache", () => {
    const loadSpy = vi.spyOn(THREE.TextureLoader.prototype, "load");
    invalidateTexture("mai-richiesta.png");
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
