import { describe, it, expect } from "vitest";
import { COLOR_PALETTE, sanitizeDisplayName, resolveDisplayName, generateProceduralName, pickColor } from "./identity.js";

describe("identity — generazione nome+colore (Fase 6B.client-2)", () => {
  describe("sanitizeDisplayName", () => {
    it("fa il trim degli spazi ai bordi", () => {
      expect(sanitizeDisplayName("  Mario  ")).toBe("Mario");
    });

    it("tronca a 24 caratteri", () => {
      const long = "A".repeat(40);
      expect(sanitizeDisplayName(long)).toHaveLength(24);
    });

    it("ritorna null per una stringa vuota o solo spazi", () => {
      expect(sanitizeDisplayName("")).toBeNull();
      expect(sanitizeDisplayName("   ")).toBeNull();
    });

    it("ritorna null per valori non stringa", () => {
      expect(sanitizeDisplayName(undefined)).toBeNull();
      expect(sanitizeDisplayName(42)).toBeNull();
      expect(sanitizeDisplayName(null)).toBeNull();
      expect(sanitizeDisplayName({ toString: () => "hack" })).toBeNull();
    });
  });

  describe("resolveDisplayName", () => {
    it("usa il nome fornito quando valido", () => {
      expect(resolveDisplayName("Mario")).toBe("Mario");
    });

    it("ricade sulla generazione procedurale quando il nome non è valido", () => {
      const resolved = resolveDisplayName("   ");
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved).toMatch(/^\S+ \S+$/); // "Animale Aggettivo"
    });
  });

  describe("generateProceduralName", () => {
    it("genera un nome nel formato 'Animale Aggettivo'", () => {
      const name = generateProceduralName();
      expect(name).toMatch(/^\S+ \S+$/);
    });
  });

  describe("pickColor", () => {
    it("sceglie un colore della palette non ancora in uso", () => {
      const used = new Set([COLOR_PALETTE[0]]);
      const picked = pickColor(used);
      expect(COLOR_PALETTE).toContain(picked);
      expect(picked).not.toBe(COLOR_PALETTE[0]);
    });

    it("nessuna collisione finché la palette ha colori liberi", () => {
      const used = new Set<string>();
      for (let i = 0; i < COLOR_PALETTE.length; i++) {
        const picked = pickColor(used);
        expect(used.has(picked)).toBe(false);
        used.add(picked);
      }
      expect(used.size).toBe(COLOR_PALETTE.length);
    });

    it("cicla deterministicamente sulla palette quando tutti i colori sono già in uso", () => {
      const used = new Set(COLOR_PALETTE); // tutti i colori occupati
      const picked = pickColor(used);
      expect(picked).toBe(COLOR_PALETTE[used.size % COLOR_PALETTE.length]);
    });
  });
});
