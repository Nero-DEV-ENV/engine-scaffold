import { ProcessSupervisor } from "./processSupervisor.js";
import { createHostAgentServer } from "./httpServer.js";
import { SERVER_PACKAGE_DIR, SERVER_TSCONFIG_PATH, SERVER_DIST_ENTRY_PATH, resolveTscScriptPath } from "./paths.js";

/**
 * Entry point — Fase 6F.3.a. Porta configurabile via env `HOST_AGENT_PORT`
 * (default 4100), stesso pattern di `packages/server/src/index.ts` (env
 * `PORT`, default 2567). Avviato non da `pnpm` ma direttamente da
 * start-hidden.ps1 (`node dist/index.js`, nessuna shell interposta).
 */
const port = Number(process.env.HOST_AGENT_PORT ?? 4100);

const supervisor = new ProcessSupervisor({
  cwd: SERVER_PACKAGE_DIR,
  buildCommand: [process.execPath, resolveTscScriptPath(), "-p", SERVER_TSCONFIG_PATH],
  startCommand: [process.execPath, SERVER_DIST_ENTRY_PATH],
});

const server = createHostAgentServer(supervisor);
server.listen(port, () => {
  console.log(`[host-agent] in ascolto sulla porta ${port}, pronto a gestire packages/server`);
});
