import { describe, expect, it } from "vitest";
import { clampPanelWidth, HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MAX_WIDTH_PX } from "./resizablePanel.js";

describe("clampPanelWidth", () => {
  it("restituisce il valore invariato se già dentro l'intervallo", () => {
    expect(clampPanelWidth(300, HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MAX_WIDTH_PX)).toBe(300);
  });

  it("blocca al minimo se il drag va sotto la soglia", () => {
    expect(clampPanelWidth(50, HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MAX_WIDTH_PX)).toBe(HIERARCHY_MIN_WIDTH_PX);
  });

  it("blocca al massimo se il drag va sopra la soglia", () => {
    expect(clampPanelWidth(900, HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MAX_WIDTH_PX)).toBe(HIERARCHY_MAX_WIDTH_PX);
  });

  it("accetta esattamente i valori di confine", () => {
    expect(clampPanelWidth(HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MAX_WIDTH_PX)).toBe(
      HIERARCHY_MIN_WIDTH_PX,
    );
    expect(clampPanelWidth(HIERARCHY_MAX_WIDTH_PX, HIERARCHY_MIN_WIDTH_PX, HIERARCHY_MAX_WIDTH_PX)).toBe(
      HIERARCHY_MAX_WIDTH_PX,
    );
  });
});
