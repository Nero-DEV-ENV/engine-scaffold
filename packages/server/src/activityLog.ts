import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * activityLog.ts — registro append-only (JSONL, un evento per riga) degli
 * eventi di sessione di una Room, pensato per dare all'owner/agli
 * amministratori del progetto visibilità su cosa succede in una sessione
 * collaborativa, indipendentemente da IndexedDB (che resta locale al
 * browser di ogni singolo utente, vedi punto 4a deciso con l'utente).
 *
 * Fase 6A: logga solo il ciclo di vita della Room/connessione (creazione,
 * join, leave, dispose) — non c'è ancora alcuno stato di scena da
 * sincronizzare. Le fasi successive (6B-6D, sync Transform/GameObject/
 * componenti) estenderanno `ActivityLogEntry` con i "commit" veri e propri
 * (intent validati dal server), riusando lo stesso modulo.
 *
 * Path del file configurabile (non hardcoded): il deployment reale sui due
 * VPS Hetzner non è ancora stato deciso (vedi punto 3), quindi il default
 * qui sotto è solo comodo per sviluppo locale — `configureActivityLog` va
 * richiamato con il path definitivo quando quella decisione sarà presa.
 *
 * Stato a livello di modulo (path corrente + cache "directory creata"),
 * stesso stile di ScenePersistence.ts/Physics.ts nel resto del monorepo.
 */

// Derivato dalla posizione del modulo stesso (non dalla cwd del processo):
// sia in dist/activityLog.js (build) sia in src/activityLog.ts (dev via tsx)
// il file si trova un livello sotto la root del pacchetto, quindi risalire
// di due directory da qui porta sempre a packages/server/, indipendentemente
// da dove il processo è stato avviato. La cwd-relative precedente
// ("packages/server/data/...") si rompeva se il processo veniva avviato da
// dentro packages/server stesso (path annidato duplicato) — trovato nello
// smoke test manuale.
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_LOG_PATH = join(PACKAGE_ROOT, "data", "activity.log");

let logFilePath = DEFAULT_LOG_PATH;
let ensuredDirFor: string | null = null;

export type ActivityLogEntry =
  | { type: "room_created"; roomId: string; timestamp: number }
  | { type: "client_joined"; roomId: string; sessionId: string; timestamp: number }
  | { type: "client_left"; roomId: string; sessionId: string; code: number | undefined; timestamp: number }
  | { type: "room_disposed"; roomId: string; timestamp: number }
  | { type: "scene_hydrated"; roomId: string; sessionId: string; gameObjectCount: number; timestamp: number }
  | { type: "transform_committed"; roomId: string; sessionId: string; gameObjectId: string; timestamp: number }
  | { type: "gameobject_added"; roomId: string; sessionId: string; gameObjectId: string; timestamp: number }
  | { type: "gameobject_removed"; roomId: string; sessionId: string; gameObjectId: string; timestamp: number }
  | {
      type: "component_added";
      roomId: string;
      sessionId: string;
      gameObjectId: string;
      componentType: string;
      timestamp: number;
    }
  | {
      type: "component_removed";
      roomId: string;
      sessionId: string;
      gameObjectId: string;
      componentType: string;
      timestamp: number;
    }
  | {
      type: "component_updated";
      roomId: string;
      sessionId: string;
      gameObjectId: string;
      componentType: string;
      timestamp: number;
    };

/** Cambia il file su cui `logActivity` scrive (es. per i test, o per il path reale di deploy). */
export function configureActivityLog(path: string): void {
  logFilePath = path;
  ensuredDirFor = null;
}

/** @internal — usato dai test per ripartire dal path di default fra un test e l'altro. */
export function _resetActivityLogForTests(): void {
  logFilePath = DEFAULT_LOG_PATH;
  ensuredDirFor = null;
}

/**
 * Appende una riga JSON per `entry` al file di log configurato. Sincrono
 * (appendFileSync) deliberatamente: il volume di eventi in Fase 6A
 * (join/leave/dispose) è troppo basso perché l'I/O asincrono porti un
 * vantaggio reale, e la scrittura sincrona evita qualunque possibile
 * interleaving/corruzione di righe fra eventi concorrenti — da rivalutare
 * se una fase futura introduce un volume di eventi molto più alto (es. un
 * commit per ogni tick di drag del gizmo, non ancora deciso).
 */
export function logActivity(entry: ActivityLogEntry): void {
  if (ensuredDirFor !== logFilePath) {
    mkdirSync(dirname(logFilePath), { recursive: true });
    ensuredDirFor = logFilePath;
  }
  appendFileSync(logFilePath, JSON.stringify(entry) + "\n", "utf-8");
}
