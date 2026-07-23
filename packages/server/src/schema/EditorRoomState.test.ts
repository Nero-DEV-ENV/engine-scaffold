import { describe, it, expect } from "vitest";
import type { TransformData } from "@engine/core";
import { EditorRoomState, TransformState, toTransformState, applyTransformData } from "./EditorRoomState.js";

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
