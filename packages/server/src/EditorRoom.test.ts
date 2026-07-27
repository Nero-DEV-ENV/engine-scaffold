import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TransformData, ComponentData } from "@engine/core";
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

/** Fase 6D — componente di esempio (SphereCollider: nessuna union annidata, il più semplice dei cinque per i test). */
function sampleComponent(radius = 0.5): ComponentData {
  return { type: "SphereCollider", radius, friction: 0.5, restitution: 0, isTrigger: false };
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
          { id: "go-1", transform: sampleTransform(1, 2, 3), components: [] },
          { id: "go-2", transform: sampleTransform(4, 5, 6), components: [] },
        ],
      });

      await waitFor(() => room.state.transforms.size === 2);
      expect(room.state.transforms.get("go-1")?.position.x).toBe(1);
      expect(room.state.transforms.get("go-2")?.position.x).toBe(4);
    });

    it("hydrateScene è idempotente: non sovrascrive un gameObjectId già presente", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("hydrateScene", { gameObjects: [{ id: "go-1", transform: sampleTransform(1, 1, 1), components: [] }] });
      await waitFor(() => room.state.transforms.size === 1);

      // Un secondo hydrate con dati diversi per lo stesso id NON deve
      // sovrascrivere: lo stato già nella Room resta la fonte di verità.
      client.send("hydrateScene", { gameObjects: [{ id: "go-1", transform: sampleTransform(99, 99, 99), components: [] }] });
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

      client.send("hydrateScene", { gameObjects: [{ id: "go-1", transform: sampleTransform(1, 1, 1), components: [] }] });
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

      client.send("hydrateScene", { gameObjects: [{ id: "go-demo", transform: sampleTransform(), components: [] }] });
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
      clientA.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [] }] });
      await waitFor(() => room.state.transforms.has("demo-cube"));

      clientA.send("removeGameObject", { gameObjectId: "demo-cube" });
      await waitFor(() => !room.state.transforms.has("demo-cube"));

      // Un client C, connesso DOPO la rimozione, hydrata la SUA copia locale
      // dello stesso id (che possiede ancora, ignaro della rimozione altrui)
      // — non deve ricomparire in transforms.
      const clientC = await testServer.connectTo(room);
      clientC.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform(9, 9, 9), components: [] }] });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(room.state.transforms.has("demo-cube")).toBe(false);
    });

    it("hydrateScene risponde con gameObjectsRemoved (mirato) al client che ha provato a hydratare un id già rimosso", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);

      clientA.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [] }] });
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
          { id: "demo-cube", transform: sampleTransform(9, 9, 9), components: [] },
          { id: "demo-sphere", transform: sampleTransform(), components: [] },
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

      client.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [] }] });
      await waitFor(() => room.state.transforms.has("demo-cube"));
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-invio

      expect(received).toBe(false);
    });
  });

  describe("sync componenti (Fase 6D)", () => {
    it("addComponent aggiunge un componente a un GameObject esistente", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("addComponent", { gameObjectId: "go-1", component: sampleComponent(0.5) });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      const state = room.state.components.get("go-1:SphereCollider");
      expect(state?.gameObjectId).toBe("go-1");
      expect(state?.type).toBe("SphereCollider");
      expect(JSON.parse(state?.dataJson ?? "{}")).toEqual(sampleComponent(0.5));

      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "component_added")).toBe(true);
    });

    it("addComponent su un tipo già presente sullo stesso GameObject viene ignorato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("addComponent", { gameObjectId: "go-1", component: sampleComponent(0.5) });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      client.send("addComponent", { gameObjectId: "go-1", component: sampleComponent(9) });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      const state = room.state.components.get("go-1:SphereCollider");
      expect(JSON.parse(state?.dataJson ?? "{}")).toEqual(sampleComponent(0.5));
    });

    it("addComponent su un gameObjectId sconosciuto viene ignorato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addComponent", { gameObjectId: "go-inesistente", component: sampleComponent() });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(room.state.components.size).toBe(0);
    });

    it("removeComponent rimuove l'entry da components", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));
      client.send("addComponent", { gameObjectId: "go-1", component: sampleComponent() });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      client.send("removeComponent", { gameObjectId: "go-1", type: "SphereCollider" });
      await waitFor(() => !room.state.components.has("go-1:SphereCollider"));

      expect(room.state.components.has("go-1:SphereCollider")).toBe(false);
      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "component_removed")).toBe(true);
    });

    it("removeComponent su un componente inesistente viene ignorato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("removeComponent", { gameObjectId: "go-1", type: "SphereCollider" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "component_removed")).toBe(false);
    });

    it("updateComponent aggiorna i campi di un componente già presente", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));
      client.send("addComponent", { gameObjectId: "go-1", component: sampleComponent(0.5) });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      client.send("updateComponent", { gameObjectId: "go-1", component: sampleComponent(2) });
      await waitFor(() => JSON.parse(room.state.components.get("go-1:SphereCollider")?.dataJson ?? "{}").radius === 2);

      const entries = readLoggedEntries(logPath);
      expect(entries.some((entry) => (entry as { type: string }).type === "component_updated")).toBe(true);
    });

    it("updateComponent su un componente non ancora presente viene ignorato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("updateComponent", { gameObjectId: "go-1", component: sampleComponent() });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(room.state.components.has("go-1:SphereCollider")).toBe(false);
    });

    it("addComponent/removeComponent/updateComponent sono bloccati se il gameObjectId è lockato da un ALTRO client", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);
      const clientB = await testServer.connectTo(room);

      clientA.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));
      clientA.send("addComponent", { gameObjectId: "go-1", component: sampleComponent(0.5) });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      clientA.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      clientB.send("updateComponent", { gameObjectId: "go-1", component: sampleComponent(9) });
      clientB.send("removeComponent", { gameObjectId: "go-1", type: "SphereCollider" });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(JSON.parse(room.state.components.get("go-1:SphereCollider")?.dataJson ?? "{}").radius).toBe(0.5);
    });

    it("addComponent/removeComponent/updateComponent riescono se il gameObjectId è lockato dallo STESSO client", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));

      client.send("beginEdit", { gameObjectId: "go-1" });
      await waitFor(() => room.state.editingBy.has("go-1"));

      client.send("addComponent", { gameObjectId: "go-1", component: sampleComponent(0.5) });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      client.send("updateComponent", { gameObjectId: "go-1", component: sampleComponent(2) });
      await waitFor(() => JSON.parse(room.state.components.get("go-1:SphereCollider")?.dataJson ?? "{}").radius === 2);

      client.send("removeComponent", { gameObjectId: "go-1", type: "SphereCollider" });
      await waitFor(() => !room.state.components.has("go-1:SphereCollider"));

      expect(room.state.components.has("go-1:SphereCollider")).toBe(false);
    });

    it("addGameObject con components iniziali li popola in components (es. il MeshRenderer di default di Cube/Sphere/Plane)", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", {
        id: "go-1",
        kind: "box",
        name: "Cube",
        transform: sampleTransform(),
        components: [{ type: "MeshRenderer", shape: { kind: "box", size: { x: 1, y: 1, z: 1 } }, color: 0xffffff }],
      });
      await waitFor(() => room.state.components.has("go-1:MeshRenderer"));

      const state = room.state.components.get("go-1:MeshRenderer");
      expect(state?.gameObjectId).toBe("go-1");
      expect(JSON.parse(state?.dataJson ?? "{}")).toEqual({
        type: "MeshRenderer",
        shape: { kind: "box", size: { x: 1, y: 1, z: 1 } },
        color: 0xffffff,
      });
    });

    it("removeGameObject ripulisce anche le entry components associate a quel GameObject", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("addGameObject", { id: "go-1", kind: "empty", name: "GameObject", transform: sampleTransform() });
      await waitFor(() => room.state.transforms.has("go-1"));
      client.send("addComponent", { gameObjectId: "go-1", component: sampleComponent() });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      client.send("removeGameObject", { gameObjectId: "go-1" });
      await waitFor(() => !room.state.transforms.has("go-1"));

      expect(room.state.components.has("go-1:SphereCollider")).toBe(false);
    });

    it("hydrateScene popola components per ogni GameObject inviato", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("hydrateScene", {
        gameObjects: [{ id: "go-1", transform: sampleTransform(), components: [sampleComponent(0.5)] }],
      });

      await waitFor(() => room.state.components.has("go-1:SphereCollider"));
      expect(JSON.parse(room.state.components.get("go-1:SphereCollider")?.dataJson ?? "{}").radius).toBe(0.5);
    });

    it("hydrateScene è idempotente per i componenti: non sovrascrive una chiave già presente", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      client.send("hydrateScene", {
        gameObjects: [{ id: "go-1", transform: sampleTransform(), components: [sampleComponent(0.5)] }],
      });
      await waitFor(() => room.state.components.has("go-1:SphereCollider"));

      client.send("hydrateScene", {
        gameObjects: [{ id: "go-1", transform: sampleTransform(), components: [sampleComponent(99)] }],
      });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(JSON.parse(room.state.components.get("go-1:SphereCollider")?.dataJson ?? "{}").radius).toBe(0.5);
    });

    it("hydrateScene salta i componenti di un GameObject già rimosso definitivamente", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);

      clientA.send("hydrateScene", { gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [] }] });
      await waitFor(() => room.state.transforms.has("demo-cube"));
      clientA.send("removeGameObject", { gameObjectId: "demo-cube" });
      await waitFor(() => !room.state.transforms.has("demo-cube"));

      const clientC = await testServer.connectTo(room);
      clientC.send("hydrateScene", {
        gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [sampleComponent()] }],
      });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(room.state.components.has("demo-cube:SphereCollider")).toBe(false);
    });

    it("hydrateScene NON resuscita un componente già rimosso su un GameObject ancora vivo (join tardivo)", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);

      clientA.send("hydrateScene", {
        gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [sampleComponent()] }],
      });
      await waitFor(() => room.state.components.has("demo-cube:SphereCollider"));

      clientA.send("removeComponent", { gameObjectId: "demo-cube", type: "SphereCollider" });
      await waitFor(() => !room.state.components.has("demo-cube:SphereCollider"));

      // Un client C, connesso DOPO la rimozione, hydrata la SUA copia locale
      // (che possiede ancora il componente, ignaro della rimozione altrui)
      // — non deve ricomparire in components. demo-cube stesso resta vivo
      // (mai rimosso come GameObject), solo il suo SphereCollider lo è.
      const clientC = await testServer.connectTo(room);
      clientC.send("hydrateScene", {
        gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [sampleComponent(9)] }],
      });
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-cambiamento

      expect(room.state.components.has("demo-cube:SphereCollider")).toBe(false);
    });

    it("hydrateScene risponde con componentsRemoved (mirato) al client che ha provato a hydratare una chiave già rimossa", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const clientA = await testServer.connectTo(room);

      clientA.send("hydrateScene", {
        gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [sampleComponent()] }],
      });
      await waitFor(() => room.state.components.has("demo-cube:SphereCollider"));

      clientA.send("removeComponent", { gameObjectId: "demo-cube", type: "SphereCollider" });
      await waitFor(() => !room.state.components.has("demo-cube:SphereCollider"));

      const clientC = await testServer.connectTo(room);
      const received = new Promise<{ componentKeys: string[] }>((resolve) => {
        clientC.onMessage("componentsRemoved", (payload: { componentKeys: string[] }) => resolve(payload));
      });

      clientC.send("hydrateScene", {
        gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [sampleComponent(9)] }],
      });

      const payload = await received;
      expect(payload.componentKeys).toEqual(["demo-cube:SphereCollider"]);
    });

    it("hydrateScene non invia componentsRemoved quando non ci sono chiavi scartate", async () => {
      const room = await testServer.createRoom<EditorRoom>("editor_room");
      const client = await testServer.connectTo(room);

      let received = false;
      client.onMessage("componentsRemoved", () => {
        received = true;
      });

      client.send("hydrateScene", {
        gameObjects: [{ id: "demo-cube", transform: sampleTransform(), components: [sampleComponent()] }],
      });
      await waitFor(() => room.state.components.has("demo-cube:SphereCollider"));
      await new Promise((resolve) => setTimeout(resolve, 100)); // verifica un NON-invio

      expect(received).toBe(false);
    });
  });
});
