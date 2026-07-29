import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectFolderSession, resolveWithinRoot, DEFAULT_IGNORED_NAMES } from "./projectFolder.js";

/**
 * projectFolder.test.ts — Fase 10A. Nessun mock del filesystem: fixture
 * reali su una cartella temporanea (stesso stile già usato da
 * processSupervisor.test.ts per gli stessi motivi — verificare
 * empiricamente il comportamento reale invece di assumerlo).
 */

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "host-agent-project-test-"));
  writeFileSync(path.join(fixtureRoot, "scene.json"), "{}");
  writeFileSync(path.join(fixtureRoot, "readme.md"), "# demo");
  mkdirSync(path.join(fixtureRoot, "Assets"));
  writeFileSync(path.join(fixtureRoot, "Assets", "model.glb"), "");
  mkdirSync(path.join(fixtureRoot, "Assets", "Textures"));
  writeFileSync(path.join(fixtureRoot, "Assets", "Textures", "wall.png"), "");
  mkdirSync(path.join(fixtureRoot, "node_modules"));
  writeFileSync(path.join(fixtureRoot, "node_modules", "dummy.js"), "");
  mkdirSync(path.join(fixtureRoot, ".git"));
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("resolveWithinRoot", () => {
  it("risolve un sotto-percorso semplice dentro la root", () => {
    expect(resolveWithinRoot("/tmp/progetto", "Assets")).toBe(path.resolve("/tmp/progetto", "Assets"));
  });

  it("risolve '.' come la root stessa", () => {
    expect(resolveWithinRoot("/tmp/progetto", ".")).toBe(path.resolve("/tmp/progetto"));
  });

  it("blocca un tentativo di path traversal semplice", () => {
    expect(resolveWithinRoot("/tmp/progetto", "../fuori")).toBeNull();
  });

  it("blocca un tentativo di path traversal annidato", () => {
    expect(resolveWithinRoot("/tmp/progetto", "Assets/../../fuori")).toBeNull();
  });

  it("blocca un percorso assoluto estraneo passato come 'relativo'", () => {
    expect(resolveWithinRoot("/tmp/progetto", "/etc/passwd")).toBeNull();
  });

  it("non blocca per errore una cartella sorella col prefisso giusto ma root diversa", () => {
    // "/tmp/progetto-altro" NON deve risultare "dentro" "/tmp/progetto" solo
    // perché la stringa inizia con lo stesso prefisso senza separatore.
    expect(resolveWithinRoot("/tmp/progetto", "../progetto-altro")).toBeNull();
  });
});

describe("ProjectFolderSession", () => {
  it("rifiuta l'apertura di un percorso relativo", () => {
    const session = new ProjectFolderSession();
    const result = session.openRoot("relativo/qualche/cartella");
    expect(result.ok).toBe(false);
    expect(session.getState().rootPath).toBeNull();
  });

  it("rifiuta l'apertura di un percorso inesistente", () => {
    const session = new ProjectFolderSession();
    const result = session.openRoot(path.join(fixtureRoot, "non-esiste"));
    expect(result.ok).toBe(false);
  });

  it("rifiuta l'apertura di un percorso che è un file, non una cartella", () => {
    const session = new ProjectFolderSession();
    const result = session.openRoot(path.join(fixtureRoot, "readme.md"));
    expect(result.ok).toBe(false);
  });

  it("apre correttamente una cartella reale e la riflette in getState()", () => {
    const session = new ProjectFolderSession();
    const result = session.openRoot(fixtureRoot);
    expect(result.ok).toBe(true);
    expect(session.getState().rootPath).toBe(path.resolve(fixtureRoot));
  });

  it("closeRoot() torna false se nessuna root era aperta, true se la chiude davvero", () => {
    const session = new ProjectFolderSession();
    expect(session.closeRoot()).toBe(false);
    session.openRoot(fixtureRoot);
    expect(session.closeRoot()).toBe(true);
    expect(session.getState().rootPath).toBeNull();
  });

  it("listDirectory() restituisce null se nessuna root è aperta", async () => {
    const session = new ProjectFolderSession();
    await expect(session.listDirectory(".")).resolves.toBeNull();
  });

  it("listDirectory('.') elenca la root escludendo node_modules/.git, cartelle prima dei file", async () => {
    const session = new ProjectFolderSession();
    session.openRoot(fixtureRoot);
    const entries = await session.listDirectory(".");
    expect(entries).toEqual([
      { name: "Assets", kind: "directory" },
      { name: "readme.md", kind: "file" },
      { name: "scene.json", kind: "file" },
    ]);
  });

  it("listDirectory() naviga in una sottocartella reale", async () => {
    const session = new ProjectFolderSession();
    session.openRoot(fixtureRoot);
    const entries = await session.listDirectory("Assets");
    expect(entries).toEqual([
      { name: "Textures", kind: "directory" },
      { name: "model.glb", kind: "file" },
    ]);
  });

  it("listDirectory() restituisce null per un tentativo di path traversal", async () => {
    const session = new ProjectFolderSession();
    session.openRoot(fixtureRoot);
    await expect(session.listDirectory("../../fuori")).resolves.toBeNull();
  });

  it("listDirectory() restituisce null per una sottocartella inesistente", async () => {
    const session = new ProjectFolderSession();
    session.openRoot(fixtureRoot);
    await expect(session.listDirectory("NonEsiste")).resolves.toBeNull();
  });

  it("DEFAULT_IGNORED_NAMES contiene le cartelle standard da escludere", () => {
    expect(DEFAULT_IGNORED_NAMES.has("node_modules")).toBe(true);
    expect(DEFAULT_IGNORED_NAMES.has(".git")).toBe(true);
  });

  describe("readFile", () => {
    it("restituisce null se nessuna root è aperta", async () => {
      const session = new ProjectFolderSession();
      await expect(session.readFile("readme.md")).resolves.toBeNull();
    });

    it("legge i byte reali di un file dentro la root", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      const data = await session.readFile("Assets/model.glb");
      expect(data).not.toBeNull();
      expect(Buffer.isBuffer(data)).toBe(true);
    });

    it("legge un file in una sottocartella annidata", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      const data = await session.readFile("Assets/Textures/wall.png");
      expect(data).not.toBeNull();
    });

    it("restituisce null per un tentativo di path traversal", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      await expect(session.readFile("../../fuori")).resolves.toBeNull();
    });

    it("restituisce null per un percorso inesistente", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      await expect(session.readFile("Assets/non-esiste.glb")).resolves.toBeNull();
    });

    it("restituisce null se il percorso è una cartella, non un file", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      await expect(session.readFile("Assets")).resolves.toBeNull();
    });
  });
});

describe("ProjectFolderSession — persistenza dello stato (Fase 10D)", () => {
  // Cartella dedicata SOLO al file di stato, separata da fixtureRoot (che
  // simula la project folder dell'utente): nessun mock, stessa filosofia
  // del resto del file — fixture reali su cartelle temporanee.
  let stateDir: string;

  beforeAll(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "host-agent-project-state-"));
  });

  afterAll(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("senza statePath configurato, si comporta come prima di Fase 10D (solo in memoria, nessun file scritto)", () => {
    const session = new ProjectFolderSession();
    const result = session.openRoot(fixtureRoot);
    expect(result.ok).toBe(true);
    expect(session.getState().rootPath).toBe(path.resolve(fixtureRoot));
  });

  it("openRoot() scrive rootPath su statePath, creando le cartelle intermedie mancanti", () => {
    const statePath = path.join(stateDir, "openroot", "nested", "state.json");
    const session = new ProjectFolderSession({ statePath });
    session.openRoot(fixtureRoot);
    const written = JSON.parse(readFileSync(statePath, "utf8"));
    expect(written).toEqual({ rootPath: path.resolve(fixtureRoot) });
  });

  it("closeRoot() aggiorna statePath a rootPath: null", () => {
    const statePath = path.join(stateDir, "closeroot", "state.json");
    const session = new ProjectFolderSession({ statePath });
    session.openRoot(fixtureRoot);
    session.closeRoot();
    const written = JSON.parse(readFileSync(statePath, "utf8"));
    expect(written).toEqual({ rootPath: null });
  });

  it("restore() riapre silenziosamente l'ultima root nota, se ancora valida", () => {
    const statePath = path.join(stateDir, "restore-ok", "state.json");
    const first = new ProjectFolderSession({ statePath });
    first.openRoot(fixtureRoot);

    const second = new ProjectFolderSession({ statePath });
    expect(second.getState().rootPath).toBeNull();
    second.restore();
    expect(second.getState().rootPath).toBe(path.resolve(fixtureRoot));
  });

  it("restore() è un no-op silenzioso se statePath non è configurato", () => {
    const session = new ProjectFolderSession();
    expect(() => session.restore()).not.toThrow();
    expect(session.getState().rootPath).toBeNull();
  });

  it("restore() fallisce silenziosamente se il file di stato non esiste ancora (primo avvio)", () => {
    const statePath = path.join(stateDir, "mai-scritto", "state.json");
    const session = new ProjectFolderSession({ statePath });
    expect(() => session.restore()).not.toThrow();
    expect(session.getState().rootPath).toBeNull();
  });

  it("restore() fallisce silenziosamente se il file di stato contiene JSON non valido", () => {
    const dir = path.join(stateDir, "json-non-valido");
    mkdirSync(dir, { recursive: true });
    const statePath = path.join(dir, "state.json");
    writeFileSync(statePath, "{ non è json valido");
    const session = new ProjectFolderSession({ statePath });
    session.restore();
    expect(session.getState().rootPath).toBeNull();
  });

  it("restore() fallisce silenziosamente se il file di stato non ha la shape attesa", () => {
    const dir = path.join(stateDir, "shape-inattesa");
    mkdirSync(dir, { recursive: true });
    const statePath = path.join(dir, "state.json");
    writeFileSync(statePath, JSON.stringify({ qualcosaAltro: 42 }));
    const session = new ProjectFolderSession({ statePath });
    session.restore();
    expect(session.getState().rootPath).toBeNull();
  });

  it("restore() fallisce silenziosamente se la root salvata non esiste più su disco", () => {
    const dir = path.join(stateDir, "root-rimossa");
    mkdirSync(dir, { recursive: true });
    const statePath = path.join(dir, "state.json");
    const rootOraRimossa = path.join(fixtureRoot, "una-cartella-che-non-esiste");
    writeFileSync(statePath, JSON.stringify({ rootPath: rootOraRimossa }));
    const session = new ProjectFolderSession({ statePath });
    session.restore();
    expect(session.getState().rootPath).toBeNull();
  });
});
