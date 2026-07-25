import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProcessSupervisor, type AgentState } from "./processSupervisor.js";

/**
 * processSupervisor.test.ts — Fase 6F.3.a. Nessun mock di child_process:
 * spawna davvero i fixture qui sotto (coerente con lo stile già usato nel
 * resto del repo — verificare empiricamente invece di assumere,
 * specialmente per comportamenti di kill()/exit non ovvi fra piattaforme).
 */

let fixtureDir: string;
let longRunningScript: string;
let exitZeroScript: string;
let exitOneScript: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), "host-agent-test-"));

  longRunningScript = path.join(fixtureDir, "long-running.mjs");
  writeFileSync(
    longRunningScript,
    'console.log("fixture: avviato");\nsetInterval(() => console.log("fixture: tick"), 50);\n',
  );

  exitZeroScript = path.join(fixtureDir, "exit-zero.mjs");
  writeFileSync(exitZeroScript, 'console.log("fixture: build ok");\nprocess.exit(0);\n');

  exitOneScript = path.join(fixtureDir, "exit-one.mjs");
  writeFileSync(exitOneScript, 'console.error("fixture: build fallita");\nprocess.exit(1);\n');
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function waitForState(
  supervisor: ProcessSupervisor,
  predicate: (state: AgentState) => boolean,
  timeoutMs = 5000,
): Promise<AgentState> {
  const current = supervisor.getState();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      supervisor.off("state", onState);
      reject(new Error(`Timeout in attesa dello stato atteso — ultimo stato: ${JSON.stringify(supervisor.getState())}`));
    }, timeoutMs);

    function onState(state: AgentState): void {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      supervisor.off("state", onState);
      resolve(state);
    }

    supervisor.on("state", onState);
  });
}

describe("ProcessSupervisor", () => {
  let supervisor: ProcessSupervisor;

  afterEach(async () => {
    const status = supervisor?.getState().status;
    if (status && status !== "idle" && status !== "error") {
      supervisor.stop();
      await waitForState(supervisor, (s) => s.status === "idle", 5000).catch(() => undefined);
    }
  });

  it("avvia direttamente un processo long-running (senza build) e transita a running", async () => {
    supervisor = new ProcessSupervisor({ cwd: fixtureDir, startCommand: [process.execPath, longRunningScript] });
    expect(supervisor.start()).toBe(true);
    const state = await waitForState(supervisor, (s) => s.status === "running");
    expect(state.status).toBe("running");
  });

  it("stop() ferma un processo running e torna a idle", async () => {
    supervisor = new ProcessSupervisor({ cwd: fixtureDir, startCommand: [process.execPath, longRunningScript] });
    supervisor.start();
    await waitForState(supervisor, (s) => s.status === "running");
    expect(supervisor.stop()).toBe(true);
    const state = await waitForState(supervisor, (s) => s.status === "idle");
    expect(state.status).toBe("idle");
  });

  it("catena build (successo) -> long-running: building -> starting -> running", async () => {
    supervisor = new ProcessSupervisor({
      cwd: fixtureDir,
      buildCommand: [process.execPath, exitZeroScript],
      startCommand: [process.execPath, longRunningScript],
    });
    supervisor.start();
    await waitForState(supervisor, (s) => s.status === "building");
    const state = await waitForState(supervisor, (s) => s.status === "running");
    expect(state.status).toBe("running");
  });

  it("build fallita -> stato error, il long-running non parte mai", async () => {
    supervisor = new ProcessSupervisor({
      cwd: fixtureDir,
      buildCommand: [process.execPath, exitOneScript],
      startCommand: [process.execPath, longRunningScript],
    });
    supervisor.start();
    const state = await waitForState(supervisor, (s) => s.status === "error");
    expect(state.status).toBe("error");
  });

  it("start() è no-op se lo stato non è idle/error", async () => {
    supervisor = new ProcessSupervisor({ cwd: fixtureDir, startCommand: [process.execPath, longRunningScript] });
    supervisor.start();
    await waitForState(supervisor, (s) => s.status === "running");
    expect(supervisor.start()).toBe(false);
  });

  it("stop() è no-op se lo stato è idle", () => {
    supervisor = new ProcessSupervisor({ cwd: fixtureDir, startCommand: [process.execPath, longRunningScript] });
    expect(supervisor.stop()).toBe(false);
  });

  it("cattura le righe di stdout del processo nel ring buffer", async () => {
    supervisor = new ProcessSupervisor({ cwd: fixtureDir, startCommand: [process.execPath, longRunningScript] });
    supervisor.start();
    await waitForState(supervisor, (s) => s.status === "running");
    if (supervisor.getRecentLogs().length === 0) {
      await new Promise<void>((resolve) => supervisor.once("log", () => resolve()));
    }
    const logs = supervisor.getRecentLogs();
    expect(logs.some((entry) => entry.line.includes("fixture: avviato"))).toBe(true);
  });
});
