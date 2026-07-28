import { ProcessSupervisor } from "./processSupervisor.js";
import { TunnelHostSession } from "./tunnelHostSession.js";
import { ProjectFolderSession } from "./projectFolder.js";
import { createHostAgentServer } from "./httpServer.js";
import { SERVER_PACKAGE_DIR, SERVER_TSCONFIG_PATH, SERVER_DIST_ENTRY_PATH, resolveTscScriptPath } from "./paths.js";

/**
 * Entry point — Fase 6F.3.a (ProcessSupervisor) + Fase 6F.3.b
 * (TunnelHostSession) + Fase 10A (ProjectFolderSession). Porta
 * configurabile via env `HOST_AGENT_PORT` (default 4100), stesso pattern
 * di `packages/server/src/index.ts` (env `PORT`, default 2567). Avviato
 * non da `pnpm` ma direttamente da start-hidden.ps1 (`node dist/index.js`,
 * nessuna shell interposta).
 *
 * `colyseusHttpUrl` per TunnelHostSession: stessa env `PORT`/fallback 2567
 * lette da packages/server/src/index.ts — host-agent spawna quel processo
 * SENZA impostare esplicitamente `PORT` nell'ambiente del figlio (eredita
 * l'ambiente di host-agent stesso, vedi ProcessSupervisor.spawnLongRunning),
 * quindi la stessa variabile letta qui riflette coerentemente la porta
 * reale su cui packages/server finirà per ascoltare.
 */
const port = Number(process.env.HOST_AGENT_PORT ?? 4100);
const colyseusPort = Number(process.env.PORT ?? 2567);
const colyseusHttpUrl = `http://localhost:${colyseusPort}`;

const supervisor = new ProcessSupervisor({
  cwd: SERVER_PACKAGE_DIR,
  buildCommand: [process.execPath, resolveTscScriptPath(), "-p", SERVER_TSCONFIG_PATH],
  startCommand: [process.execPath, SERVER_DIST_ENTRY_PATH],
});

const tunnelHost = new TunnelHostSession({ colyseusHttpUrl });
const projectFolder = new ProjectFolderSession();

const server = createHostAgentServer(supervisor, tunnelHost, projectFolder);
server.listen(port, () => {
  console.log(`[host-agent] in ascolto sulla porta ${port}, pronto a gestire packages/server (editor_room atteso su ${colyseusHttpUrl})`);
});
