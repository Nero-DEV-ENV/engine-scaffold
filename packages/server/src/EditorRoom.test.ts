import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TransformData } from "@engine/core";
import { Server } from "colyseus";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { EditorRoom } from "./EditorRoom.js";
import { configureActivityLog, _resetActivityLogForTests } from "./activityLog.js";
import { waitFor } from "./testUtils.js";

function readLoggedEntries(path: string): unknown[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function sampleTransform(x = 1, y = 2, z = 3): TransformData {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

describe("EditorRoom", () => {
  // Un solo boot/shutdown per l'intero file, non uno per test: @colyseus/testing
  // usa una porta fissa (2568) quando gli si passa un'istanza Server già creata
  // (il parametro port di boot() viene ignorato in quel caso — verificato sul
  // sorgente reale del pacchetto), quindi un bind/unbind ripetuto per ogni test
  // introduce un race di riuso della porta. Fra un test e l'altro si usa
  // `cleanup()` (disconnette i client, non richiude il socket) invece di un
  // nuovo `shutdown()`+boot.
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    const server = new Server();
    server.define("editor_room", EditorRoom);
    testServer = await boot(server);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  let logPath: string;

  beforeEach(() => {
    logPath = join(mkdtempSync(join(tmpdir(), "activity-log-")), "activity.log");
    configureActivityLog(logPath);
  });

  afterEach(async () => {
    await testServer.cleanup();
    _resetActivityLogForTests();
  });

  describe("ciclo di vita (Fase 6A)", () => {
    it("logga room_created alla creazione della stanza", async () => {
      await testServer.createRoom("editor_room");
      const entries = readLoggedEntries(logPath);
      expect(entries).toEqual([expect.objectContaining({ type: "room_created" })]);
    });

    it("logga client_joined quando un client entra", async () => {
      const room = await testServer.createRoom("editor_room");
      await testServer.connectTo(room);
      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "client_joined")).toBe(true);
    });

    it("logga client_left quando un client esce", async () => {
      const room = await testServer.createRoom("editor_room");
      const client = await testServer.connectTo(room);
      await client.leave();
      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "client_left")).toBe(true);
    });
  });

  describe("sync Transform (Fase 6B)", () => {
    it("hydrateScene popola this.state.transforms per ogni GameObject inviato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("hydrateScene", {
        gameObjects: [
          { id: "go-1", transform: sampleTransform(1, 2, 3) },
          { id: "go-2", transform: sampleTransform(4, 5, 6) },
        ],
      });

      await waitFor(() => room.state.transforms.size === 2);
      expect(room.state.transforms.get("go-1")?.position.x).toBe(1);
      expect(room.state.transforms.get("go-2")?.position.x).toBe(4);
    });

    it("hydrateScene è idempotente: non sovrascrive un gameObjectId già presente", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("hydrateScene", { gameObjects: [{ id: "go-1", transform: sampleTransform(1, 1, 1) }] });
      await waitFor(() => room.state.transforms.size === 1);

      // Un secondo hydrate con dati diversi per lo stesso id NON deve
      // sovrascrivere: lo stato già nella Room resta la fonte di verità.
      client.send("hydrateScene", { gameObjects: [{ id: "go-1", transform: sampleTransform(99, 99, 99) }] });
      // Non c'è un evento osservabile da attendere per "non è successo
      // nulla": una breve attesa fissa qui è accettabile perché il test
      // verifica un NON-cambiamento, non un cambiamento (waitFor non si
      // applicherebbe a un'assenza di evento).
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(room.state.transforms.get("go-1")?.position.x).toBe(1);
    });

    it("commitTransform aggiorna il Transform di un gameObjectId già hydratato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("hydrateScene", { gameObjects: [{ id: "go-1", transform: sampleTransform(1, 1, 1) }] });
      await waitFor(() => room.state.transforms.size === 1);

      client.send("commitTransform", { gameObjectId: "go-1", transform: sampleTransform(7, 8, 9) });
      await waitFor(() => room.state.transforms.get("go-1")?.position.x === 7);

      expect(room.state.transforms.get("go-1")?.position.y).toBe(8);
      expect(room.state.transforms.get("go-1")?.position.z).toBe(9);

      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "transform_committed")).toBe(true);
    });

    it("commitTransform su un gameObjectId sconosciuto viene ignorato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("commitTransform", { gameObjectId: "go-inesistente", transform: sampleTransform() });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(room.state.transforms.size).toBe(0);
      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "transform_committed")).toBe(false);
    });
  });

  describe("identità e presence (Fase 6B.client-2)", () => {
    it("assegna il displayName fornito dal client", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room, { displayName: "Mario" });
      await waitFor(() => room.state.clients.has(client.sessionId));

      expect(room.state.clients.get(client.sessionId)?.name).toBe("Mario");
    });

    it("genera un nome procedurale quando il client non ne fornisce uno", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);
      await waitFor(() => room.state.clients.has(client.sessionId));

      const name = room.state.clients.get(client.sessionId)?.name;
      expect(name).toBeTruthy();
      expect(name).toMatch(/^\S+ \S+$/);
    });

    it("assegna colori diversi a due client connessi contemporaneamente", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);
      await waitFor(() => room.state.clients.has(clientA.sessionId));
      const clientB = await testServer.connectTo(room);
      await waitFor(() => room.state.clients.has(clientB.sessionId));

      const colorA = room.state.clients.get(clientA.sessionId)?.color;
      const colorB = room.state.clients.get(clientB.sessionId)?.color;
      expect(colorA).not.toBe(colorB);
    });

    it("rimuove il client da clients quando esce", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);
      await waitFor(() => room.state.clients.has(client.sessionId));

      await client.leave();
      await waitFor(() => !room.state.clients.has(client.sessionId));
      expect(room.state.clients.has(client.sessionId)).toBe(false);
    });
  });

  describe("lock ottimistico beginEdit/endEdit (Fase 6B.client-2)", () => {
    it("beginEdit registra il sessionId del client in editingBy", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      expect(room.state.editingBy.get("go-1")).toBe(client.sessionId);
    });

    it("un secondo client non può ottenere il lock su un gameObjectId già lockato da un altro", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);
      const clientB = await testServer.connectTo(room);

      clientA.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      clientB.send("beginEdit", { gameObjectId: "go-1" });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(room.state.editingBy.get("go-1")).toBe(clientA.sessionId);
    });

    it("endEdit rilascia il lock quando richiesto da chi lo detiene", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      client.send("endEdit", { gameObjectId: "go-1" });
      await waitFor(() => !room.state.editingBy.has("go-1"));

      expect(room.state.editingBy.has("go-1")).toBe(false);
    });

    it("endEdit da parte di un client che non detiene il lock viene ignorato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);
      const clientB = await testServer.connectTo(room);

      clientA.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      clientB.send("endEdit", { gameObjectId: "go-1" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(room.state.editingBy.get("go-1")).toBe(clientA.sessionId);
    });

    it("un editingBy orfano viene ripulito quando il client detentore si disconnette", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      await client.leave();
      await waitFor(() => !room.state.editingBy.has("go-1"));

      expect(room.state.editingBy.has("go-1")).toBe(false);
    });

    it("la disconnessione di un client non lockatario non tocca il lock di un altro client", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);
      const clientB = await testServer.connectTo(room);

      clientA.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      await clientB.leave();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(room.state.editingBy.get("go-1")).toBe(clientA.sessionId);
    });
  });

  describe("sync aggiunta/rimozione GameObject (Fase 6C.2)", () => {
    it("addGameObject popola transforms e gameObjectMeta per il nuovo id", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-nuovo", kind: "box", name: "Cube", transform: sampleTransform(1, 2, 3) });
      await waitFor(() => room.state.transforms.has("go-nuovo"));

      expect(room.state.transforms.get("go-nuovo")?.position.x).toBe(1);
      expect(room.state.gameObjectMeta.get("go-nuovo")?.kind).toBe("box");
      expect(room.state.gameObjectMeta.get("go-nuovo")?.name).toBe("Cube");

      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "gameobject_added")).toBe(true);
    });

    it("addGameObject con un id già presente viene ignorato (duplicato)", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "box", name: "Cube", transform: sampleTransform(1, 1, 1) });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("addGameObject", { id: "go-1", kind: "sphere", name: "Sphere", transform: sampleTransform(9, 9, 9) });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(room.state.transforms.get("go-1")?.position.x).toBe(1);
      expect(room.state.gameObjectMeta.get("go-1")?.kind).toBe("box");
    });

    it("removeGameObject rimuove l'entry da transforms e gameObjectMeta", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "box", name: "Cube", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("removeGameObject", { gameObjectId: "go-1" });
      await waitFor(() => !room.state.transforms.has("go-1"));

      expect(room.state.transforms.has("go-1")).toBe(false);
      expect(room.state.gameObjectMeta.has("go-1")).toBe(false);

      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "gameobject_removed")).toBe(true);
    });

    it("removeGameObject su un id pre-esistente (hydratato, mai in gameObjectMeta) funziona comunque", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("hydrateScene", { gameObjects: [{ id: "go-demo", transform: sampleTransform() }] });
      await waitFor(() => room.state.transforms.has("go-demo"));
      expect(room.state.gameObjectMeta.has("go-demo")).toBe(false);

      client.send("removeGameObject", { gameObjectId: "go-demo" });
      await waitFor(() => !room.state.transforms.has("go-demo"));

      expect(room.state.transforms.has("go-demo")).toBe(false);
    });

    it("removeGameObject su un gameObjectId sconosciuto viene ignorato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("removeGameObject", { gameObjectId: "go-inesistente" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "gameobject_removed")).toBe(false);
    });

    it("removeGameObject è bloccato se il gameObjectId è lockato da un ALTRO client", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);
      const clientB = await testServer.connectTo(room);

      clientA.send("addGameObject", { id: "go-1", kind: "box", name: "Cube", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      clientA.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      clientB.send("removeGameObject", { gameObjectId: "go-1" });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(room.state.transforms.has("go-1")).toBe(true);
    });

    it("removeGameObject riesce se il gameObjectId è lockato dallo STESSO client che lo rimuove", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "box", name: "Cube", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      client.send("removeGameObject", { gameObjectId: "go-1" });
      await waitFor(() => !room.state.transforms.has("go-1"));

      expect(room.state.transforms.has("go-1")).toBe(false);
    });

    it("removeGameObject ripulisce un editingBy associato, evitando lock orfani", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "box", name: "Cube", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      client.send("removeGameObject", { gameObjectId: "go-1" });
      await waitFor(() => !room.state.transforms.has("go-1"));

      expect(room.state.editingBy.has("go-1")).toBe(false);
    });

    it("hydrateScene NON resuscita un gameObjectId già rimosso (join tardivo, fix scoperto in smoke-test)", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);

      // A hydrata un oggetto "pre-esistente" (id fisso, come demo-cube in ogni client) e poi lo rimuove.
      clientA.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform() }] });
      await waitFor(() => room.state.transforms.has("demo-cube"));

      clientA.send("removeGameObject", { gameObjectId: "demo-cube" });
      await waitFor(() => !room.state.transforms.has("demo-cube"));

      // Un client C, connesso DOPO la rimozione, hydrata la SUA copia locale
      // dello stesso id (che possiede ancora, ignaro della rimozione altrui)
      // — non deve ricomparire in transforms.
      const clientC = await testServer.connectTo(room);
      clientC.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform(9, 9, 9) }] });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(room.state.transforms.has("demo-cube")).toBe(false);
    });

    it("hydrateScene risponde con gameObjectsRemoved (mirato) al client che ha provato a hydratare un id già rimosso", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);

      clientA.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform() }] });
      await waitFor(() => room.state.transforms.has("demo-cube"));

      clientA.send("removeGameObject", { gameObjectId: "demo-cube" });
      await waitFor(() => !room.state.transforms.has("demo-cube"));

      const clientC = await testServer.connectTo(room);
      const received = new Promise<{ gameObjectIds: string[] }>((resolve) => {
        clientC.onMessage("gameObjectsRemoved", (payload: { gameObjectIds: string[] }) => resolve(payload));
      });

      // demo-sphere non è mai stato rimosso: deve restare fuori dalla risposta.
      clientC.send("hydrateScene", {
        gameObjects: [
          { id: "demo-cube", transform: sampleTransform(9, 9, 9) },
          { id: "demo-sphere", transform: sampleTransform() },
        ],
      });

      const payload = await received;
      expect(payload.gameObjectIds).toEqual(["demo-cube"]);
    });

    it("hydrateScene non invia gameObjectsRemoved quando non ci sono id scartati", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      let received = false;
      client.onMessage("gameObjectsRemoved", () => {
        received = true;
      });

      client.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform() }] });
      await waitFor(() => room.state.transforms.has("demo-cube"));
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-invio

      expect(received).toBe(false);
    });
  });
});
