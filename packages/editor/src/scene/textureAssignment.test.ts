import { describe, it, expect, beforeEach } from "vitest";
import type { MeshRendererData } from "@engine/core";
import {
  armedTextureSlotStore,
  armMaterialMapSlot,
  disarmTextureSlot,
  resolveTextureAssignment,
} from "./textureAssignment.js";

function meshRendererData(): MeshRendererData {
  return { type: "MeshRenderer", shape: { kind: "box", size: { x: 1, y: 1, z: 1 } }, color: 0xffffff };
}

describe("armMaterialMapSlot / disarmTextureSlot", () => {
  beforeEach(() => {
    disarmTextureSlot();
  });

  it("arma lo slot indicato per il GameObject dato", () => {
    armMaterialMapSlot("go-1", "albedoMap");
    expect(armedTextureSlotStore.get()).toEqual({ gameObjectId: "go-1", field: "albedoMap" });
  });

  it("cliccare di nuovo lo stesso slot già armato lo disarma (toggle)", () => {
    armMaterialMapSlot("go-1", "normalMap");
    armMaterialMapSlot("go-1", "normalMap");
    expect(armedTextureSlotStore.get()).toBeNull();
  });

  it("armare un GameObject diverso sostituisce lo slot invece di disarmarlo", () => {
    armMaterialMapSlot("go-1", "albedoMap");
    armMaterialMapSlot("go-2", "albedoMap");
    expect(armedTextureSlotStore.get()).toEqual({ gameObjectId: "go-2", field: "albedoMap" });
  });

  it("armare un campo diverso sullo stesso GameObject sostituisce lo slot invece di disarmarlo (Fase 11B.2)", () => {
    armMaterialMapSlot("go-1", "albedoMap");
    armMaterialMapSlot("go-1", "roughnessMap");
    expect(armedTextureSlotStore.get()).toEqual({ gameObjectId: "go-1", field: "roughnessMap" });
  });

  it("disarmTextureSlot azzera lo slot armato", () => {
    armMaterialMapSlot("go-1", "albedoMap");
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

  // ---- Fase 11B.2 — le 5 mappe nuove ------------------------------------

  it.each(["normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const)(
    "assegna il percorso relativo a %s SENZA resettare color (a differenza di albedoMap)",
    (field) => {
      const armed = { gameObjectId: "go-1", field } as const;
      const data = { ...meshRendererData(), color: 0xff0000 };
      const result = resolveTextureAssignment(armed, "go-1", data, "Textures/wood.png");
      expect(result).toEqual({ ...data, [field]: "Textures/wood.png" });
      expect(result?.color).toBe(0xff0000);
    }
  );
});
