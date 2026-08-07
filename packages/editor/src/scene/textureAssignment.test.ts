import { describe, it, expect, beforeEach } from "vitest";
import type { MeshRendererData } from "@engine/core";
import {
  armedTextureSlotStore,
  armAlbedoMapSlot,
  disarmTextureSlot,
  resolveTextureAssignment,
} from "./textureAssignment.js";

function meshRendererData(): MeshRendererData {
  return { type: "MeshRenderer", shape: { kind: "box", size: { x: 1, y: 1, z: 1 } }, color: 0xffffff };
}

describe("armAlbedoMapSlot / disarmTextureSlot", () => {
  beforeEach(() => {
    disarmTextureSlot();
  });

  it("arma lo slot Albedo per il GameObject dato", () => {
    armAlbedoMapSlot("go-1");
    expect(armedTextureSlotStore.get()).toEqual({ gameObjectId: "go-1", field: "albedoMap" });
  });

  it("cliccare di nuovo lo stesso slot già armato lo disarma (toggle)", () => {
    armAlbedoMapSlot("go-1");
    armAlbedoMapSlot("go-1");
    expect(armedTextureSlotStore.get()).toBeNull();
  });

  it("armare un GameObject diverso sostituisce lo slot invece di disarmarlo", () => {
    armAlbedoMapSlot("go-1");
    armAlbedoMapSlot("go-2");
    expect(armedTextureSlotStore.get()).toEqual({ gameObjectId: "go-2", field: "albedoMap" });
  });

  it("disarmTextureSlot azzera lo slot armato", () => {
    armAlbedoMapSlot("go-1");
    disarmTextureSlot();
    expect(armedTextureSlotStore.get()).toBeNull();
  });
});

describe("resolveTextureAssignment", () => {
  it("restituisce null se nessuno slot è armato", () => {
    const result = resolveTextureAssignment(null, "go-1", meshRendererData(), "Textures/wood.png");
    expect(result).toBeNull();
  });

  it("restituisce null se lo slot armato appartiene a un altro GameObject (selezione cambiata)", () => {
    const armed = { gameObjectId: "go-1", field: "albedoMap" } as const;
    const result = resolveTextureAssignment(armed, "go-2", meshRendererData(), "Textures/wood.png");
    expect(result).toBeNull();
  });

  it("restituisce null se il GameObject selezionato non ha un MeshRenderer", () => {
    const armed = { gameObjectId: "go-1", field: "albedoMap" } as const;
    const result = resolveTextureAssignment(armed, "go-1", null, "Textures/wood.png");
    expect(result).toBeNull();
  });

  it("assegna il percorso relativo ad albedoMap preservando metalness/roughness", () => {
    const armed = { gameObjectId: "go-1", field: "albedoMap" } as const;
    const data = { ...meshRendererData(), metalness: 0.3, roughness: 0.7 };
    const result = resolveTextureAssignment(armed, "go-1", data, "Textures/wood_albedo.png");
    expect(result).toEqual({ ...data, albedoMap: "Textures/wood_albedo.png", color: 0xffffff });
  });

  it("resetta color a bianco per non far interferire un colore già impostato con la texture", () => {
    const armed = { gameObjectId: "go-1", field: "albedoMap" } as const;
    const data = { ...meshRendererData(), color: 0xff0000 };
    const result = resolveTextureAssignment(armed, "go-1", data, "Textures/wood_albedo.png");
    expect(result?.color).toBe(0xffffff);
  });

  it("sovrascrive un albedoMap già presente con quello appena assegnato", () => {
    const armed = { gameObjectId: "go-1", field: "albedoMap" } as const;
    const data = { ...meshRendererData(), albedoMap: "Textures/old.png" };
    const result = resolveTextureAssignment(armed, "go-1", data, "Textures/new.png");
    expect(result?.albedoMap).toBe("Textures/new.png");
  });
});
