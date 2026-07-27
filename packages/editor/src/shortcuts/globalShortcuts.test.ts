import { describe, it, expect } from "vitest";
import { resolveShortcutAction, type ShortcutInput } from "./globalShortcuts.js";

function baseInput(overrides?: Partial<ShortcutInput>): ShortcutInput {
  return {
    key: "a",
    ctrlOrCmd: false,
    targetIsEditable: false,
    hasSelection: true,
    hasHandle: true,
    saveLoadBusy: false,
    ...overrides,
  };
}

describe("resolveShortcutAction", () => {
  describe("Delete", () => {
    it("elimina quando c'è selezione, handle pronto e il focus non è editabile", () => {
      const action = resolveShortcutAction(baseInput({ key: "Delete" }));
      expect(action).toEqual({ kind: "delete" });
    });

    it("nessuna azione senza selezione", () => {
      const action = resolveShortcutAction(baseInput({ key: "Delete", hasSelection: false }));
      expect(action).toBeNull();
    });

    it("nessuna azione se l'handle non è ancora pronto (bootstrap Viewport)", () => {
      const action = resolveShortcutAction(baseInput({ key: "Delete", hasHandle: false }));
      expect(action).toBeNull();
    });

    it("ignorato quando il focus è su un campo di testo editabile", () => {
      const action = resolveShortcutAction(baseInput({ key: "Delete", targetIsEditable: true }));
      expect(action).toBeNull();
    });

    it("Backspace non è un trigger (solo il tasto Delete, coerente con Unity su Windows)", () => {
      const action = resolveShortcutAction(baseInput({ key: "Backspace" }));
      expect(action).toBeNull();
    });
  });

  describe("Ctrl/Cmd+S (save)", () => {
    it("salva quando l'handle è pronto e non è già in corso un salvataggio", () => {
      const action = resolveShortcutAction(baseInput({ key: "s", ctrlOrCmd: true }));
      expect(action).toEqual({ kind: "save" });
    });

    it("riconosce anche la lettera maiuscola (Shift+Ctrl+S produce key='S')", () => {
      const action = resolveShortcutAction(baseInput({ key: "S", ctrlOrCmd: true }));
      expect(action).toEqual({ kind: "save" });
    });

    it("nessuna azione senza il modificatore Ctrl/Cmd", () => {
      const action = resolveShortcutAction(baseInput({ key: "s", ctrlOrCmd: false }));
      expect(action).toBeNull();
    });

    it("nessuna azione se l'handle non è pronto", () => {
      const action = resolveShortcutAction(baseInput({ key: "s", ctrlOrCmd: true, hasHandle: false }));
      expect(action).toBeNull();
    });

    it("nessuna azione se un salvataggio/caricamento è già in corso", () => {
      const action = resolveShortcutAction(baseInput({ key: "s", ctrlOrCmd: true, saveLoadBusy: true }));
      expect(action).toBeNull();
    });

    it("scatta indipendentemente dal focus su un campo di testo (a differenza di Delete)", () => {
      const action = resolveShortcutAction(baseInput({ key: "s", ctrlOrCmd: true, targetIsEditable: true }));
      expect(action).toEqual({ kind: "save" });
    });
  });

  describe("Ctrl/Cmd+O (load)", () => {
    it("carica quando l'handle è pronto e non è già in corso un'azione", () => {
      const action = resolveShortcutAction(baseInput({ key: "o", ctrlOrCmd: true }));
      expect(action).toEqual({ kind: "load" });
    });

    it("nessuna azione se un salvataggio/caricamento è già in corso", () => {
      const action = resolveShortcutAction(baseInput({ key: "o", ctrlOrCmd: true, saveLoadBusy: true }));
      expect(action).toBeNull();
    });
  });

  it("nessuna azione per una combinazione non mappata", () => {
    const action = resolveShortcutAction(baseInput({ key: "x", ctrlOrCmd: true }));
    expect(action).toBeNull();
  });
});
