import { describe, it, expect, vi } from "vitest";
import type { GameObject } from "@engine/core";
import type { EditorSceneHandle } from "./createEditorScene.js";
import { ADD_GAME_OBJECT_OPTIONS } from "./addOptions.js";
import { buildSceneContextMenuItems } from "./contextMenuItems.js";

function fakeGameObject(name: string): GameObject {
  return { name } as unknown as GameObject;
}

describe("buildSceneContextMenuItems", () => {
  describe("con un target (click destro su un oggetto)", () => {
    it("restituisce una sola voce 'Elimina'", () => {
      const target = fakeGameObject("Cube");
      const handle = { removeGameObject: vi.fn() } as unknown as EditorSceneHandle;

      const items = buildSceneContextMenuItems(target, handle);

      expect(items).toHaveLength(1);
      expect(items[0]?.label).toBe("Elimina");
    });

    it("'Elimina' chiama EditorSceneHandle.removeGameObject con il target", () => {
      const target = fakeGameObject("Cube");
      const removeGameObject = vi.fn();
      const handle = { removeGameObject } as unknown as EditorSceneHandle;

      const items = buildSceneContextMenuItems(target, handle);
      items[0]?.onSelect();

      expect(removeGameObject).toHaveBeenCalledWith(target);
    });

    it("'Elimina' non lancia se l'handle è null (stesso trattamento del bottone Inspector)", () => {
      const target = fakeGameObject("Cube");
      const items = buildSceneContextMenuItems(target, null);

      expect(() => items[0]?.onSelect()).not.toThrow();
    });
  });

  describe("senza target (click destro su area vuota)", () => {
    it("restituisce esattamente le opzioni Empty/Cube/Sphere/Plane, nello stesso ordine di ADD_GAME_OBJECT_OPTIONS", () => {
      const handle = { addGameObject: vi.fn() } as unknown as EditorSceneHandle;

      const items = buildSceneContextMenuItems(null, handle);

      expect(items.map((item) => item.label)).toEqual(ADD_GAME_OBJECT_OPTIONS.map((option) => option.label));
    });

    it("ogni opzione chiama EditorSceneHandle.addGameObject col kind corrispondente", () => {
      const addGameObject = vi.fn();
      const handle = { addGameObject } as unknown as EditorSceneHandle;

      const items = buildSceneContextMenuItems(null, handle);
      items.forEach((item) => item.onSelect());

      const calledKinds = addGameObject.mock.calls.map((call) => call[0]);
      expect(calledKinds).toEqual(ADD_GAME_OBJECT_OPTIONS.map((option) => option.kind));
    });

    it("non lancia se l'handle è null (bootstrap Viewport non ancora completo)", () => {
      const items = buildSceneContextMenuItems(null, null);

      expect(() => items.forEach((item) => item.onSelect())).not.toThrow();
    });
  });
});
