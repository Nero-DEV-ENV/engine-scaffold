import { describe, expect, it } from "vitest";
import {
  PROJECT_TREE_ROOT_PATH,
  INITIAL_PROJECT_TREE_STATE,
  classifyProjectEntry,
  joinProjectPath,
  breadcrumbSegments,
  parentProjectPath,
  changedPathsToReload,
  projectTreeReducer,
  type ProjectTreeState,
} from "./projectTreeState.js";
import type { ProjectEntry } from "../network/projectFolderClient.js";

describe("classifyProjectEntry", () => {
  it("classifica una directory come 'folder' indipendentemente dal nome", () => {
    expect(classifyProjectEntry({ name: "models.glb", kind: "directory" })).toBe("folder");
  });

  it("riconosce i modelli .gltf/.glb", () => {
    expect(classifyProjectEntry({ name: "Character.glb", kind: "file" })).toBe("model");
    expect(classifyProjectEntry({ name: "scene.gltf", kind: "file" })).toBe("model");
  });

  it("riconosce le texture .png/.jpg/.jpeg", () => {
    expect(classifyProjectEntry({ name: "albedo.png", kind: "file" })).toBe("texture");
    expect(classifyProjectEntry({ name: "normal.jpg", kind: "file" })).toBe("texture");
    expect(classifyProjectEntry({ name: "spec.JPEG", kind: "file" })).toBe("texture");
  });

  it("classifica un'estensione non riconosciuta come 'other'", () => {
    expect(classifyProjectEntry({ name: "README.md", kind: "file" })).toBe("other");
  });

  it("classifica un file senza estensione come 'other'", () => {
    expect(classifyProjectEntry({ name: "LICENSE", kind: "file" })).toBe("other");
  });
});

describe("joinProjectPath", () => {
  it("non aggiunge prefisso quando il genitore è la root", () => {
    expect(joinProjectPath(PROJECT_TREE_ROOT_PATH, "models")).toBe("models");
  });

  it("concatena con '/' per un genitore non-root", () => {
    expect(joinProjectPath("models", "car.glb")).toBe("models/car.glb");
  });

  it("supporta più livelli di annidamento", () => {
    expect(joinProjectPath("models/vehicles", "car.glb")).toBe("models/vehicles/car.glb");
  });
});

describe("projectTreeReducer", () => {
  const rootEntries: ProjectEntry[] = [
    { name: "models", kind: "directory" },
    { name: "readme.md", kind: "file" },
  ];

  it("'reset' riporta allo stato iniziale", () => {
    const dirty: ProjectTreeState = {
      expandedPaths: new Set(["models"]),
      nodes: new Map([[PROJECT_TREE_ROOT_PATH, { loadState: "loaded", entries: rootEntries }]]),
      selectedPath: "models",
    };
    expect(projectTreeReducer(dirty, { type: "reset" })).toEqual(INITIAL_PROJECT_TREE_STATE);
  });

  it("'toggle-expand' espande un percorso non ancora espanso", () => {
    const next = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, { type: "toggle-expand", path: "models" });
    expect(next.expandedPaths.has("models")).toBe(true);
  });

  it("'toggle-expand' collassa un percorso già espanso (idempotente sui due click)", () => {
    const expanded = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, { type: "toggle-expand", path: "models" });
    const collapsed = projectTreeReducer(expanded, { type: "toggle-expand", path: "models" });
    expect(collapsed.expandedPaths.has("models")).toBe(false);
  });

  it("'toggle-expand' non tocca 'nodes' né 'selectedPath'", () => {
    const next = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, { type: "toggle-expand", path: "models" });
    expect(next.nodes).toBe(INITIAL_PROJECT_TREE_STATE.nodes);
    expect(next.selectedPath).toBeNull();
  });

  it("'load-start' segna il nodo come 'loading' con entries vuote", () => {
    const next = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, { type: "load-start", path: PROJECT_TREE_ROOT_PATH });
    expect(next.nodes.get(PROJECT_TREE_ROOT_PATH)).toEqual({ loadState: "loading", entries: [] });
  });

  it("'load-success' popola le entries e segna 'loaded'", () => {
    const started = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, {
      type: "load-start",
      path: PROJECT_TREE_ROOT_PATH,
    });
    const next = projectTreeReducer(started, {
      type: "load-success",
      path: PROJECT_TREE_ROOT_PATH,
      entries: rootEntries,
    });
    expect(next.nodes.get(PROJECT_TREE_ROOT_PATH)).toEqual({ loadState: "loaded", entries: rootEntries });
  });

  it("'load-error' segna 'error' con il messaggio, entries vuote", () => {
    const next = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, {
      type: "load-error",
      path: "models",
      error: "Impossibile leggere la cartella.",
    });
    expect(next.nodes.get("models")).toEqual({
      loadState: "error",
      entries: [],
      error: "Impossibile leggere la cartella.",
    });
  });

  it("'load-*' per un percorso non tocca i nodi già caricati per altri percorsi", () => {
    const rootLoaded = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, {
      type: "load-success",
      path: PROJECT_TREE_ROOT_PATH,
      entries: rootEntries,
    });
    const next = projectTreeReducer(rootLoaded, { type: "load-start", path: "models" });
    expect(next.nodes.get(PROJECT_TREE_ROOT_PATH)).toEqual({ loadState: "loaded", entries: rootEntries });
    expect(next.nodes.get("models")).toEqual({ loadState: "loading", entries: [] });
  });

  it("'select' imposta selectedPath senza toccare 'nodes'/'expandedPaths'", () => {
    const next = projectTreeReducer(INITIAL_PROJECT_TREE_STATE, { type: "select", path: "models/car.glb" });
    expect(next.selectedPath).toBe("models/car.glb");
    expect(next.nodes).toBe(INITIAL_PROJECT_TREE_STATE.nodes);
    expect(next.expandedPaths).toBe(INITIAL_PROJECT_TREE_STATE.expandedPaths);
  });
});

describe("breadcrumbSegments", () => {
  it("scompone un percorso di primo livello in un solo segmento", () => {
    expect(breadcrumbSegments("Assets")).toEqual(["Assets"]);
  });

  it("scompone un percorso annidato nei suoi segmenti, in ordine", () => {
    expect(breadcrumbSegments("Assets/Models/Trees")).toEqual(["Assets", "Models", "Trees"]);
  });
});

describe("parentProjectPath", () => {
  it("restituisce null per un elemento di primo livello (risalire esce dalla griglia)", () => {
    expect(parentProjectPath("Assets")).toBeNull();
  });

  it("risale di un livello per un percorso annidato", () => {
    expect(parentProjectPath("Assets/Models/Trees")).toBe("Assets/Models");
  });

  it("risale di un livello da una cartella a due livelli fino al primo", () => {
    expect(parentProjectPath("Assets/Models")).toBe("Assets");
  });
});

describe("changedPathsToReload (Fase 10G)", () => {
  it("include la root se segnalata come cambiata, anche con nessun nodo espanso", () => {
    expect(changedPathsToReload([PROJECT_TREE_ROOT_PATH], new Set())).toEqual([PROJECT_TREE_ROOT_PATH]);
  });

  it("esclude un percorso cambiato ma mai espanso (mai un livello mai guardato)", () => {
    expect(changedPathsToReload(["Assets"], new Set())).toEqual([]);
  });

  it("include un percorso cambiato che è già stato espanso", () => {
    expect(changedPathsToReload(["Assets"], new Set(["Assets"]))).toEqual(["Assets"]);
  });

  it("filtra un mix di percorsi tracciati e non tracciati, preservando l'ordine", () => {
    expect(changedPathsToReload([PROJECT_TREE_ROOT_PATH, "Assets", "Assets/Textures"], new Set(["Assets"]))).toEqual([
      PROJECT_TREE_ROOT_PATH,
      "Assets",
    ]);
  });

  it("restituisce un array vuoto se non c'è nulla da ricaricare", () => {
    expect(changedPathsToReload([], new Set(["Assets"]))).toEqual([]);
  });
});
