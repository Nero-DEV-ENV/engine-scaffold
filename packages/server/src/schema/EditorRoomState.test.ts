import { describe, it, expect } from "vitest";
import type { TransformData, ComponentData } from "@engine/core";
import {
  EditorRoomState,
  TransformState,
  toTransformState,
  applyTransformData,
  toGameObjectMetaState,
  componentKey,
  toComponentState,
  applyComponentDataToState,
} from "./EditorRoomState.js";

function sampleComponent(radius = 0.5): ComponentData {
  return { type: "SphereCollider", radius, friction: 0.5, restitution: 0, isTrigger: false };
}

function sampleTransform(offset = 0): TransformData {
  return {
    position: { x: 1 + offset, y: 2 + offset, z: 3 + offset },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

describe("EditorRoomState — schema Transform (Fase 6B)", () => {
  it("toTransformState riporta correttamente position/rotation/scale", () => {
    const state = toTransformState(sampleTransform());
    expect(state.position.x).toBe(1);
    expect(state.position.y).toBe(2);
    expect(state.position.z).toBe(3);
    expect(state.rotation).toEqual(expect.objectContaining({ x: 0, y: 0, z: 0, w: 1 }));
    expect(state.scale).toEqual(expect.objectContaining({ x: 1, y: 1, z: 1 }));
  });

  it("applyTransformData muta un'istanza TransformState esistente invece di sostituirla", () => {
    const state = new TransformState();
    const before = state;
    applyTransformData(state, sampleTransform(10));
    expect(state).toBe(before); // stessa istanza, solo le proprietà sono cambiate
    expect(state.position.x).toBe(11);
  });

  it("EditorRoomState.transforms è una MapSchema vuota all'inizializzazione", () => {
    const roomState = new EditorRoomState();
    expect(roomState.transforms.size).toBe(0);
  });

  it("set/get/delete su transforms funzionano per gameObjectId (predisposizione per add/remove in 6C)", () => {
    const roomState = new EditorRoomState();
    roomState.transforms.set("go-1", toTransformState(sampleTransform()));
    expect(roomState.transforms.has("go-1")).toBe(true);
    roomState.transforms.delete("go-1");
    expect(roomState.transforms.has("go-1")).toBe(false);
  });
});

describe("EditorRoomState — gameObjectMeta (Fase 6C.2)", () => {
  it("toGameObjectMetaState riporta correttamente kind e name", () => {
    const state = toGameObjectMetaState("box", "Cube");
    expect(state.kind).toBe("box");
    expect(state.name).toBe("Cube");
  });

  it("EditorRoomState.gameObjectMeta è una MapSchema vuota all'inizializzazione", () => {
    const roomState = new EditorRoomState();
    expect(roomState.gameObjectMeta.size).toBe(0);
  });

  it("set/get/delete su gameObjectMeta funzionano per gameObjectId", () => {
    const roomState = new EditorRoomState();
    roomState.gameObjectMeta.set("go-1", toGameObjectMetaState("sphere", "Sphere"));
    expect(roomState.gameObjectMeta.has("go-1")).toBe(true);
    expect(roomState.gameObjectMeta.get("go-1")?.kind).toBe("sphere");
    roomState.gameObjectMeta.delete("go-1");
    expect(roomState.gameObjectMeta.has("go-1")).toBe(false);
  });

  it("delete su un gameObjectId mai presente in gameObjectMeta è un no-op sicuro (caso oggetto pre-esistente)", () => {
    const roomState = new EditorRoomState();
    expect(() => roomState.gameObjectMeta.delete("go-mai-esistito")).not.toThrow();
    expect(roomState.gameObjectMeta.size).toBe(0);
  });
});

describe("EditorRoomState — components (Fase 6D)", () => {
  it("componentKey costruisce la chiave composita gameObjectId:type", () => {
    expect(componentKey("go-1", "SphereCollider")).toBe("go-1:SphereCollider");
  });

  it("toComponentState riporta correttamente gameObjectId/type/dataJson", () => {
    const state = toComponentState("go-1", sampleComponent(0.5));
    expect(state.gameObjectId).toBe("go-1");
    expect(state.type).toBe("SphereCollider");
    expect(JSON.parse(state.dataJson)).toEqual(sampleComponent(0.5));
  });

  it("applyComponentDataToState muta il dataJson di un'istanza ComponentState esistente invece di sostituirla", () => {
    const state = toComponentState("go-1", sampleComponent(0.5));
    const before = state;
    applyComponentDataToState(state, sampleComponent(2));
    expect(state).toBe(before); // stessa istanza, solo dataJson è cambiato
    expect(JSON.parse(state.dataJson).radius).toBe(2);
  });

  it("EditorRoomState.components è una MapSchema vuota all'inizializzazione", () => {
    const roomState = new EditorRoomState();
    expect(roomState.components.size).toBe(0);
  });

  it("set/get/delete su components funzionano per la chiave composita", () => {
    const roomState = new EditorRoomState();
    const key = componentKey("go-1", "SphereCollider");
    roomState.components.set(key, toComponentState("go-1", sampleComponent()));
    expect(roomState.components.has(key)).toBe(true);
    expect(roomState.components.get(key)?.type).toBe("SphereCollider");
    roomState.components.delete(key);
    expect(roomState.components.has(key)).toBe(false);
  });
});
