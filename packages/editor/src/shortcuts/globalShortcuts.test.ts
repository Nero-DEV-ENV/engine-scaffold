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

  describe("Ctrl/Cmd+D (duplicate, Fase 8A)", () => {
    it("duplica quando c'è selezione e l'handle è pronto", () => {
      const action = resolveShortcutAction(baseInput({ key: "d", ctrlOrCmd: true }));
      expect(action).toEqual({ kind: "duplicate" });
    });

    it("riconosce anche la lettera maiuscola (Shift+Ctrl+D produce key='D')", () => {
      const action = resolveShortcutAction(baseInput({ key: "D", ctrlOrCmd: true }));
      expect(action).toEqual({ kind: "duplicate" });
    });

    it("nessuna azione senza il modificatore Ctrl/Cmd", () => {
      const action = resolveShortcutAction(baseInput({ key: "d", ctrlOrCmd: false }));
      expect(action).toBeNull();
    });

    it("nessuna azione senza selezione", () => {
      const action = resolveShortcutAction(baseInput({ key: "d", ctrlOrCmd: true, hasSelection: false }));
      expect(action).toBeNull();
    });

    it("nessuna azione se l'handle non è ancora pronto (bootstrap Viewport)", () => {
      const action = resolveShortcutAction(baseInput({ key: "d", ctrlOrCmd: true, hasHandle: false }));
      expect(action).toBeNull();
    });

    it("scatta indipendentemente dal focus su un campo di testo (a differenza di Delete)", () => {
      const action = resolveShortcutAction(baseInput({ key: "d", ctrlOrCmd: true, targetIsEditable: true }));
      expect(action).toEqual({ kind: "duplicate" });
    });
  });

  it("nessuna azione per una combinazione non mappata", () => {
    const action = resolveShortcutAction(baseInput({ key: "x", ctrlOrCmd: true }));
    expect(action).toBeNull();
  });

  describe("F (focus, Fase 8B)", () => {
    it("centra la camera quando c'è selezione e l'handle è pronto", () => {
      const action = resolveShortcutAction(baseInput({ key: "f" }));
      expect(action).toEqual({ kind: "focus" });
    });

    it("nessuna azione senza selezione", () => {
      const action = resolveShortcutAction(baseInput({ key: "f", hasSelection: false }));
      expect(action).toBeNull();
    });

    it("nessuna azione se l'handle non è ancora pronto", () => {
      const action = resolveShortcutAction(baseInput({ key: "f", hasHandle: false }));
      expect(action).toBeNull();
    });

    it("ignorato quando il focus è su un campo di testo editabile (a differenza di Ctrl+D)", () => {
      const action = resolveShortcutAction(baseInput({ key: "f", targetIsEditable: true }));
      expect(action).toBeNull();
    });

    it("ignorato se combinato con Ctrl/Cmd (riservato)", () => {
      const action = resolveShortcutAction(baseInput({ key: "f", ctrlOrCmd: true }));
      expect(action).toBeNull();
    });
  });

  describe("Q/W/E/R (cambio tool, Fase 8B)", () => {
    it("Q seleziona il tool 'hand'", () => {
      const action = resolveShortcutAction(baseInput({ key: "q" }));
      expect(action).toEqual({ kind: "setTool", tool: "hand" });
    });

    it("W seleziona il tool 'move'", () => {
      const action = resolveShortcutAction(baseInput({ key: "w" }));
      expect(action).toEqual({ kind: "setTool", tool: "move" });
    });

    it("E seleziona il tool 'rotate'", () => {
      const action = resolveShortcutAction(baseInput({ key: "e" }));
      expect(action).toEqual({ kind: "setTool", tool: "rotate" });
    });

    it("R seleziona il tool 'scale'", () => {
      const action = resolveShortcutAction(baseInput({ key: "r" }));
      expect(action).toEqual({ kind: "setTool", tool: "scale" });
    });

    it("non richiedono selezione né handle (preferenza UI, non azione sulla scena)", () => {
      const action = resolveShortcutAction(baseInput({ key: "w", hasSelection: false, hasHandle: false }));
      expect(action).toEqual({ kind: "setTool", tool: "move" });
    });

    it("ignorati quando il focus è su un campo di testo editabile", () => {
      const action = resolveShortcutAction(baseInput({ key: "w", targetIsEditable: true }));
      expect(action).toBeNull();
    });

    it("ignorati se combinati con Ctrl/Cmd (riservati a future scorciatoie)", () => {
      const action = resolveShortcutAction(baseInput({ key: "w", ctrlOrCmd: true }));
      expect(action).toBeNull();
    });
  });
});
