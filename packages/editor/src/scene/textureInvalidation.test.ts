import { describe, it, expect } from "vitest";
import { texturePathsAffectedByChange } from "./textureInvalidation.js";

describe("texturePathsAffectedByChange", () => {
  it("restituisce le texture la cui cartella-genitore compare fra i percorsi cambiati", () => {
    const changed = ["Textures"];
    const cached = ["Textures/wood_albedo.png", "Models/robot.gltf", "Textures/wood_normal.png"];
    expect(texturePathsAffectedByChange(changed, cached)).toEqual(["Textures/wood_albedo.png", "Textures/wood_normal.png"]);
  });

  it("una texture di primo livello (nessuna sottocartella) è affetta da un cambiamento della root '.'", () => {
    const changed = ["."];
    const cached = ["wood_albedo.png"];
    expect(texturePathsAffectedByChange(changed, cached)).toEqual(["wood_albedo.png"]);
  });

  it("un cambiamento della root '.' NON affligge una texture in una sottocartella", () => {
    const changed = ["."];
    const cached = ["Textures/wood_albedo.png"];
    expect(texturePathsAffectedByChange(changed, cached)).toEqual([]);
  });

  it("una sottocartella più profonda usa l'intero percorso della cartella-genitore, non solo l'ultimo segmento", () => {
    const changed = ["Assets/Textures"];
    const cached = ["Assets/Textures/wood.png", "Textures/wood.png"];
    expect(texturePathsAffectedByChange(changed, cached)).toEqual(["Assets/Textures/wood.png"]);
  });

  it("nessun percorso cambiato → nessuna texture affetta", () => {
    expect(texturePathsAffectedByChange([], ["Textures/wood.png"])).toEqual([]);
  });

  it("nessuna texture in cache → risultato vuoto indipendentemente dai percorsi cambiati", () => {
    expect(texturePathsAffectedByChange(["Textures"], [])).toEqual([]);
  });
});
