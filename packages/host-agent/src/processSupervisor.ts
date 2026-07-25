import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createLineSplitter } from "./lineSplitter.js";

/**
 * processSupervisor.ts — Fase 6F.3.a. Nucleo del controllo manuale
 * Start/Stop richiesto dall'utente: gestisce UN SOLO processo figlio alla
 * volta (build opzionale seguita da un lungo-vivente, o solo il
 * lungo-vivente se non c'è build da fare). Nessuna conoscenza di
 * HTTP/WebSocket qui — vedi httpServer.ts, che si limita a esporre
 * start()/stop()/getState()/getRecentLogs() e gli eventi "state"/"log".
 *
 * DECISIONE (non ovvia, verificata): entrambi i comandi (build e avvio)
 * vengono spawnati SENZA shell (`spawn(cmd, args)`, mai `shell: true` né
 * passando per pnpm). Su Windows, `shell: true` interpone un processo
 * cmd.exe fra questo agente e il vero eseguibile: killare quel cmd.exe
 * NON killa il processo reale sottostante (child_process.kill() termina
 * solo il processo diretto). Spawnando `node.exe <script>` direttamente
 * (vedi paths.ts), `child.kill()` termina il processo giusto in modo
 * affidabile su entrambe le piattaforme.
 *
 * DECISIONE: la transizione starting -> running si basa sull'evento
 * Node-level "spawn" (il processo OS esiste), NON sul parsing dell'output
 * del processo supervisionato — l'agente non deve conoscere il formato
 * dei log di ciò che avvia (oggi è sempre packages/server, ma questo
 * pacchetto non lo presume).
 */

export type AgentState =
  | { status: "idle" }
  | { status: "building" }
  | { status: "starting" }
  | { status: "running"; pid: number }
  | { status: "stopping" }
  | { status: "error"; message: string };

export interface LogEntry {
  stream: "stdout" | "stderr" | "agent";
  line: string;
  at: number;
}

export interface ProcessSupervisorOptions {
  /** Comando di build opzionale (es. tsc), eseguito PRIMA del comando di avvio. Se assente, start() passa direttamente al comando di avvio. */
  buildCommand?: readonly [string, ...string[]];
  /** Comando di avvio del processo di lunga durata. */
  startCommand: readonly [string, ...string[]];
  /** cwd per entrambi i comandi. */
  cwd: string;
  /** Righe di log mantenute in memoria per i client che si collegano dopo l'avvio. Default 500. */
  logRingBufferSize?: number;
  /** Timeout (ms) di attesa dell'evento "exit" dopo kill() prima di forzare comunque lo stato a idle. Default 5000. */
  stopTimeoutMs?: number;
}

export class ProcessSupervisor extends EventEmitter {
  private readonly buildCommand?: readonly [string, ...string[]];
  private readonly startCommand: readonly [string, ...string[]];
  private readonly cwd: string;
  private readonly logRingBufferSize: number;
  private readonly stopTimeoutMs: number;

  private state: AgentState = { status: "idle" };
  private currentChild: ChildProcess | null = null;
  private stopRequested = false;
  private readonly logRingBuffer: LogEntry[] = [];

  constructor(options: ProcessSupervisorOptions) {
    super();
    this.cwd = options.cwd;
    this.startCommand = options.startCommand;
    if (options.buildCommand) this.buildCommand = options.buildCommand;
    this.logRingBufferSize = options.logRingBufferSize ?? 500;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5000;
  }

  getState(): AgentState {
    return this.state;
  }

  getRecentLogs(): readonly LogEntry[] {
    return this.logRingBuffer;
  }

  /** Avvia (build se configurata, poi il comando di avvio). No-op (ritorna false) se lo stato non è idle/error. */
  start(): boolean {
    if (this.state.status !== "idle" && this.state.status !== "error") return false;
    this.stopRequested = false;
    if (this.buildCommand) {
      this.setState({ status: "building" });
      this.spawnBuild(this.buildCommand);
    } else {
      this.spawnLongRunning();
    }
    return true;
  }

  /** Ferma il processo attualmente in esecuzione (build o long-running). No-op (ritorna false) se non c'è nulla da fermare. */
  stop(): boolean {
    const status = this.state.status;
    if (status !== "building" && status !== "starting" && status !== "running") return false;
    if (!this.currentChild) {
      // Stato inconsistente (non dovrebbe accadere): non c'è davvero nulla da uccidere.
      this.setState({ status: "idle" });
      return false;
    }
    this.stopRequested = true;
    this.setState({ status: "stopping" });
    const child = this.currentChild;
    const timeout = setTimeout(() => {
      this.appendLog("agent", `Nessun evento "exit" entro ${this.stopTimeoutMs}ms da kill() — forzo lo stato a idle comunque.`);
      if (this.currentChild === child) this.currentChild = null;
      this.setState({ status: "idle" });
    }, this.stopTimeoutMs);
    child.once("exit", () => clearTimeout(timeout));
    child.kill();
    return true;
  }

  private spawnBuild(buildCommand: readonly [string, ...string[]]): void {
    const [cmd, ...args] = buildCommand;
    const child = spawn(cmd, args, { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"] });
    this.currentChild = child;
    this.attachLogStreams(child);

    child.on("error", (error) => {
      if (this.currentChild === child) this.currentChild = null;
      if (this.stopRequested) {
        this.setState({ status: "idle" });
      } else {
        this.setState({ status: "error", message: `Build non avviabile: ${error.message}` });
      }
    });

    child.on("exit", (code) => {
      if (this.currentChild === child) this.currentChild = null;
      if (this.stopRequested) {
        this.setState({ status: "idle" });
        return;
      }
      if (code === 0) {
        this.spawnLongRunning();
      } else {
        this.setState({ status: "error", message: `Build fallita (exit code ${code ?? "sconosciuto"}).` });
      }
    });
  }

  private spawnLongRunning(): void {
    this.setState({ status: "starting" });
    const [cmd, ...args] = this.startCommand;
    const child = spawn(cmd, args, { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"] });
    this.currentChild = child;
    this.attachLogStreams(child);

    child.on("spawn", () => {
      if (this.currentChild === child && this.state.status === "starting") {
        this.setState({ status: "running", pid: child.pid ?? -1 });
      }
    });

    child.on("error", (error) => {
      if (this.currentChild === child) this.currentChild = null;
      if (this.stopRequested) {
        this.setState({ status: "idle" });
      } else {
        this.setState({ status: "error", message: `Processo non avviabile: ${error.message}` });
      }
    });

    child.on("exit", (code, signal) => {
      if (this.currentChild === child) this.currentChild = null;
      if (this.stopRequested) {
        this.setState({ status: "idle" });
        return;
      }
      this.setState({
        status: "error",
        message: `Il processo è terminato inaspettatamente (exit code ${code ?? "n/d"}, segnale ${signal ?? "nessuno"}).`,
      });
    });
  }

  private attachLogStreams(child: ChildProcess): void {
    const feedStdout = createLineSplitter((line) => this.appendLog("stdout", line));
    const feedStderr = createLineSplitter((line) => this.appendLog("stderr", line));
    child.stdout?.on("data", feedStdout);
    child.stderr?.on("data", feedStderr);
  }

  private appendLog(stream: LogEntry["stream"], line: string): void {
    const entry: LogEntry = { stream, line, at: Date.now() };
    this.logRingBuffer.push(entry);
    if (this.logRingBuffer.length > this.logRingBufferSize) this.logRingBuffer.shift();
    this.emit("log", entry);
  }

  private setState(next: AgentState): void {
    this.state = next;
    this.emit("state", next);
  }
}
