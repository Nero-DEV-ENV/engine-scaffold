import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "colyseus";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { EditorRoom } from "./EditorRoom.js";
import { configureActivityLog, _resetActivityLogForTests } from "./activityLog.js";

function readLoggedEntries(path: string): unknown[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("EditorRoom — ciclo di vita (Fase 6A)", () => {
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
