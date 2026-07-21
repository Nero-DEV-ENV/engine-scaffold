import { describe, it, expect } from "vitest";
import { radToDeg, degToRad, roundForDisplay, parseNumericInput } from "./transformFields.js";

describe("radToDeg / degToRad", () => {
  it("converte radianti in gradi", () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
    expect(radToDeg(0)).toBe(0);
  });

  it("converte gradi in radianti", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
    expect(degToRad(0)).toBe(0);
  });

  it("round-trip gradi -> radianti -> gradi torna al valore di partenza", () => {
    const original = 47.5;
    expect(radToDeg(degToRad(original))).toBeCloseTo(original);
  });
});

describe("roundForDisplay", () => {
  it("arrotonda il rumore in virgola mobile alla precisione di default", () => {
    expect(roundForDisplay(1.0000000004)).toBe(1);
  });

  it("rispetta il numero di decimali richiesto", () => {
    expect(roundForDisplay(0.123456, 2)).toBe(0.12);
    expect(roundForDisplay(0.125, 2)).toBe(0.13);
  });

  it("non altera un numero già alla precisione richiesta", () => {
    expect(roundForDisplay(2.5, 3)).toBe(2.5);
  });
});

describe("parseNumericInput", () => {
  it("interpreta correttamente input numerici validi", () => {
    expect(parseNumericInput("3.5")).toBe(3.5);
    expect(parseNumericInput("-2")).toBe(-2);
    expect(parseNumericInput("0")).toBe(0);
  });

  it("restituisce null per stati intermedi di digitazione o input vuoto", () => {
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("   ")).toBeNull();
    expect(parseNumericInput("-")).toBeNull();
  });

  it("restituisce null per testo non numerico", () => {
    expect(parseNumericInput("abc")).toBeNull();
    expect(parseNumericInput("1,5")).toBeNull();
  });
});
