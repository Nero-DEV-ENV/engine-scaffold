import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * paths.ts — Fase 6F.3.a. Percorsi assoluti risolti relativamente a QUESTO
 * modulo (fileURLToPath(import.meta.url)), mai relativi alla CWD del
 * processo: stesso fix già applicato in packages/server/src/activityLog.ts
 * (Fase 6A) — l'agente viene avviato da start-hidden.ps1 con una CWD non
 * garantita (dipende da dove l'utente ha messo il collegamento/lo script).
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);

/** Cartella di packages/server — layout monorepo: packages/host-agent/dist/index.js -> ../../server. */
export const SERVER_PACKAGE_DIR = path.resolve(moduleDir, "../../server");
export const SERVER_TSCONFIG_PATH = path.join(SERVER_PACKAGE_DIR, "tsconfig.json");
export const SERVER_DIST_ENTRY_PATH = path.join(SERVER_PACKAGE_DIR, "dist", "index.js");

/**
 * Percorso del vero script JS del compilatore TypeScript — NON il wrapper
 * .cmd/.ps1 che pnpm mette in node_modules/.bin. Quel wrapper richiede una
 * shell per essere eseguito su Windows, il che reintrodurrebbe esattamente
 * il problema di kill inaffidabile che ProcessSupervisor esiste per
 * evitare (vedi processSupervisor.ts): con `shell: true`, Windows interpone
 * un processo shell fra l'agente e il vero eseguibile, e killare lo shell
 * non killa il figlio reale.
 *
 * `typescript` è dependency DIRETTA di questo pacchetto (non solo del
 * root) proprio per rendere risolvibile questo require.resolve: pnpm
 * isola i node_modules per pacchetto, niente hoisting "phantom" fra
 * pacchetti diversi dello stesso workspace — a differenza
 * dell'invocazione di `tsc` via script "build" negli altri pacchetti
 * (quella passa dal PATH che pnpm popola per `pnpm run`, non da un
 * require() nel codice sorgente).
 */
export function resolveTscScriptPath(): string {
  return requireFromHere.resolve("typescript/bin/tsc");
}

/**
 * Fase 10D — cartella dedicata allo stato persistito di host-agent fra
 * riavvii del processo. Deliberatamente FUORI da `dist/` (artefatto di
 * build rigenerabile/cancellabile da `pnpm build`, semanticamente sbagliato
 * per dati che devono sopravvivere a una build), un livello sopra:
 * packages/host-agent/dist/paths.js -> ../.host-agent-state. Esplicitamente
 * esclusa da git (vedi voce dedicata nel `.gitignore` root, non esisteva
 * un `.gitignore` di pacchetto prima di questa fase).
 */
export const HOST_AGENT_STATE_DIR = path.resolve(moduleDir, "../.host-agent-state");

/** Fase 10D — persiste `rootPath` di `ProjectFolderSession` fra riavvii del processo host-agent (vedi `projectFolder.ts`, `restore()`/`persistState()`). */
export const PROJECT_FOLDER_STATE_PATH = path.join(HOST_AGENT_STATE_DIR, "project-folder-state.json");
