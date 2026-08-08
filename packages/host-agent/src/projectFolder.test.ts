import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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

  describe("writeFile (Fase 10F)", () => {
    it("restituisce false se nessuna root è aperta", async () => {
      const session = new ProjectFolderSession();
      await expect(session.writeFile("scene.json", "{}")).resolves.toBe(false);
    });

    it("scrive un nuovo file dentro la root e lo si può rileggere", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      const ok = await session.writeFile("nuova-scena.json", '{"version":1,"roots":[]}');
      expect(ok).toBe(true);
      const written = readFileSync(path.join(fixtureRoot, "nuova-scena.json"), "utf8");
      expect(written).toBe('{"version":1,"roots":[]}');
    });

    it("sovrascrive un file già esistente", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      const ok = await session.writeFile("scene.json", '{"version":1,"roots":[]}');
      expect(ok).toBe(true);
      const written = readFileSync(path.join(fixtureRoot, "scene.json"), "utf8");
      expect(written).toBe('{"version":1,"roots":[]}');
    });

    it("scrive in una sottocartella già esistente", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      const ok = await session.writeFile("Assets/nuovo.json", "{}");
      expect(ok).toBe(true);
      const written = readFileSync(path.join(fixtureRoot, "Assets", "nuovo.json"), "utf8");
      expect(written).toBe("{}");
    });

    it("restituisce false per un tentativo di path traversal", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      await expect(session.writeFile("../../fuori.json", "{}")).resolves.toBe(false);
    });

    it("restituisce false se il percorso risultante è già una cartella", async () => {
      const session = new ProjectFolderSession();
      session.openRoot(fixtureRoot);
      await expect(session.writeFile("Assets", "{}")).resolves.toBe(false);
    });
  });
});

describe("ProjectFolderSession — watch automatico del filesystem (Fase 10G)", () => {
  // Cartella dedicata, separata da `fixtureRoot`: qui i test SCRIVONO/
  // rimuovono file reali per far scattare il watcher, mentre `fixtureRoot`
  // è condivisa e mutata da molti test sopra (che presumono un contenuto
  // stabile) — nessuna interferenza fra le due. `beforeEach`/`afterEach`
  // (non `beforeAll`/`afterAll`, a differenza di `fixtureRoot`): ogni test
  // qui parte da una cartella vuota, per non dover distinguere gli eventi
  // di un test da quelli residui di un altro.
  let watchFixtureRoot: string;

  beforeEach(() => {
    watchFixtureRoot = mkdtempSync(path.join(tmpdir(), "host-agent-project-watch-"));
    mkdirSync(path.join(watchFixtureRoot, "Assets"));
    mkdirSync(path.join(watchFixtureRoot, "node_modules"));
  });

  afterEach(() => {
    rmSync(watchFixtureRoot, { recursive: true, force: true });
  });

  /** Risolve col primo evento `"changed"`, o rigetta se non arriva entro `timeoutMs` — stesso pattern di `waitForState` in processSupervisor.test.ts, applicato a un evento invece che a un valore di stato. */
  function waitForChanged(session: ProjectFolderSession, timeoutMs = 2000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.off("changed", onChanged);
        reject(new Error("timeout in attesa dell'evento 'changed'"));
      }, timeoutMs);
      function onChanged(event: { changedPaths: string[] }): void {
        clearTimeout(timeout);
        session.off("changed", onChanged);
        resolve(event.changedPaths);
      }
      session.on("changed", onChanged);
    });
  }

  /** Piccola attesa dopo `openRoot()` prima di mutare il filesystem: la scansione iniziale di chokidar (attacco dei watcher nativi) non è istantanea — senza questa attesa una scrittura immediata rischierebbe di avvenire prima che i watcher siano attivi. */
  function waitForWatcherReady(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 300));
  }

  it("emette 'changed' con '.' quando un file viene aggiunto alla root", async () => {
    const session = new ProjectFolderSession({ watchDebounceMs: 30 });
    session.openRoot(watchFixtureRoot);
    await waitForWatcherReady();
    writeFileSync(path.join(watchFixtureRoot, "nuovo.txt"), "ciao");
    const changedPaths = await waitForChanged(session);
    expect(changedPaths).toEqual(["."]);
    session.closeRoot();
  });

  it("emette 'changed' con la sottocartella quando un file viene aggiunto lì dentro", async () => {
    const session = new ProjectFolderSession({ watchDebounceMs: 30 });
    session.openRoot(watchFixtureRoot);
    await waitForWatcherReady();
    writeFileSync(path.join(watchFixtureRoot, "Assets", "nuovo.glb"), "");
    const changedPaths = await waitForChanged(session);
    expect(changedPaths).toEqual(["Assets"]);
    session.closeRoot();
  });

  it("emette 'changed' con la sottocartella quando un file ESISTENTE lì dentro viene sovrascritto (Fase 11B.2 — necessario per l'invalidazione texture)", async () => {
    const existingPath = path.join(watchFixtureRoot, "Assets", "esistente.png");
    writeFileSync(existingPath, "contenuto iniziale");
    const session = new ProjectFolderSession({ watchDebounceMs: 30 });
    session.openRoot(watchFixtureRoot);
    await waitForWatcherReady();
    // Sovrascrittura in-place di un file GIÀ presente prima dell'apertura
    // della root (quindi non un add: chokidar la vede come "change") —
    // esattamente il caso reale di una texture riesportata da uno
    // strumento esterno mentre l'editor è aperto.
    writeFileSync(existingPath, "contenuto nuovo");
    const changedPaths = await waitForChanged(session);
    expect(changedPaths).toEqual(["Assets"]);
    session.closeRoot();
  });

  it("raggruppa più cambiamenti ravvicinati in un'unica notifica (debounce)", async () => {
    const session = new ProjectFolderSession({ watchDebounceMs: 100 });
    session.openRoot(watchFixtureRoot);
    await waitForWatcherReady();
    writeFileSync(path.join(watchFixtureRoot, "uno.txt"), "");
    writeFileSync(path.join(watchFixtureRoot, "Assets", "due.glb"), "");
    const changedPaths = await waitForChanged(session);
    expect(new Set(changedPaths)).toEqual(new Set([".", "Assets"]));
    session.closeRoot();
  });

  it("ignora i cambiamenti dentro le cartelle di DEFAULT_IGNORED_NAMES (es. node_modules)", async () => {
    const session = new ProjectFolderSession({ watchDebounceMs: 30 });
    session.openRoot(watchFixtureRoot);
    await waitForWatcherReady();
    writeFileSync(path.join(watchFixtureRoot, "node_modules", "dummy.js"), "");
    await expect(waitForChanged(session, 500)).rejects.toThrow();
    session.closeRoot();
  });

  it("closeRoot() ferma il watch: un cambiamento dopo la chiusura non genera più notifiche", async () => {
    const session = new ProjectFolderSession({ watchDebounceMs: 30 });
    session.openRoot(watchFixtureRoot);
    await waitForWatcherReady();
    session.closeRoot();
    writeFileSync(path.join(watchFixtureRoot, "troppo-tardi.txt"), "");
    await expect(waitForChanged(session, 500)).rejects.toThrow();
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
