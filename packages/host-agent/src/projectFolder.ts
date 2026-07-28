import { promises as fsp, statSync } from "node:fs";
import path from "node:path";

/**
 * projectFolder.ts — Fase 10A. Spike per validare l'approccio scelto per il
 * "project folder loader" (vedi documento di continuazione): estendere
 * `host-agent`, già un processo Node locale fidato e supervisionato
 * dall'editor, invece del File System Access API del browser (limiti:
 * solo Chromium, permessi non permanenti fra riavvii, nessun file watching
 * nativo — tutti risolti passando da qui).
 *
 * QUESTA FASE È DELIBERATAMENTE SOLO IL PROTOTIPO ISolato: nessuna UI
 * definitiva (arriverà in Fase 10B, che sostituirà il placeholder
 * `.project-panel-tree` in AssetsPanel.tsx). La validazione qui avviene
 * via chiamate HTTP dirette (vedi bugcheck/smoke-test manuale) e via test
 * automatici sulla logica pura di path-resolution qui sotto.
 *
 * Selezione del percorso: NESSUN file-picker nativo — host-agent è un
 * processo Node headless senza alcun binding GUI (a differenza di
 * un'app Electron). La scelta della cartella resta responsabilità
 * dell'editor (Fase 10B), che raccoglierà un percorso ASSOLUTO digitato/
 * incollato dall'utente in un campo testo e lo invierà a `POST
 * /project/open` — evita di aggiungere una dipendenza nativa (dialog di
 * sistema) solo per questo, ed è coerente con la filosofia del progetto
 * di non introdurre salti architetturali non necessari.
 *
 * Una SOLA project root aperta alla volta (stesso vincolo già applicato a
 * ProcessSupervisor per packages/server e a TunnelHostSession — niente
 * sessioni concorrenti).
 *
 * SICUREZZA: `resolveWithinRoot` è la guardia esplicita contro path
 * traversal (es. `relativePath = "../../etc"`). È essenziale perché
 * questo modulo espone lettura del filesystem locale dell'utente su HTTP
 * — seppur raggiungibile solo da localhost (stesso confine già accettato
 * per /server/* e /tunnel/host/*, vedi httpServer.ts), un percorso
 * relativo malformato o malevolo non deve MAI poter uscire dalla cartella
 * scelta dall'utente come root.
 *
 * Nessun EventEmitter/canale WS qui (a differenza di ProcessSupervisor/
 * TunnelHostSession): nessun consumer richiede ancora push in tempo reale
 * in questa fase. Da rivalutare se una fase futura (es. 10G, watch
 * automatico) introduce cambiamenti che la UI deve riflettere senza un
 * ri-fetch esplicito.
 */

/** Cartelle escluse di default dalla scansione — Fase 10A, precisazione esplicita dell'utente ("non importare cartelle node di default"). Confrontate per nome esatto, non per pattern. */
export const DEFAULT_IGNORED_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  ".vscode",
  ".idea",
]);

export interface ProjectEntry {
  name: string;
  kind: "file" | "directory";
}

export interface ProjectFolderState {
  rootPath: string | null;
}

export type OpenRootResult = { ok: true } | { ok: false; error: string };

/**
 * Risolve `relativePath` contro `root` e restituisce il percorso assoluto
 * risultante SOLO se resta dentro `root` (root stesso incluso) — altrimenti
 * `null`. Pura logica di stringhe/path, nessun accesso al filesystem: per
 * questo è testabile senza toccare disco reale (vedi projectFolder.test.ts).
 */
export function resolveWithinRoot(root: string, relativePath: string): string | null {
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relativePath);
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  if (target !== normalizedRoot && !target.startsWith(rootWithSep)) return null;
  return target;
}

export class ProjectFolderSession {
  private rootPath: string | null = null;

  /**
   * Apre `absolutePath` come nuova project root, sostituendo quella
   * eventualmente già aperta (nessuna conferma qui — la UI di 10B deciderà
   * se avvisare l'utente prima di sostituire una root già aperta).
   */
  openRoot(absolutePath: string): OpenRootResult {
    if (typeof absolutePath !== "string" || absolutePath.length === 0) {
      return { ok: false, error: "Percorso mancante." };
    }
    if (!path.isAbsolute(absolutePath)) {
      return { ok: false, error: "Il percorso deve essere assoluto." };
    }
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      return { ok: false, error: "Percorso non trovato." };
    }
    if (!stats.isDirectory()) {
      return { ok: false, error: "Il percorso non è una cartella." };
    }
    this.rootPath = path.resolve(absolutePath);
    return { ok: true };
  }

  /** Chiude la project root corrente, se presente. Restituisce `false` se non ce n'era una aperta (stesso pattern 202/409 già usato da ProcessSupervisor.stop()/TunnelHostSession.close()). */
  closeRoot(): boolean {
    if (this.rootPath === null) return false;
    this.rootPath = null;
    return true;
  }

  getState(): ProjectFolderState {
    return { rootPath: this.rootPath };
  }

  /**
   * Elenca il contenuto di `relativePath` (relativo alla root corrente,
   * `"."` per la root stessa) — cartelle prima dei file, poi ordine
   * alfabetico; le voci in `DEFAULT_IGNORED_NAMES` sono filtrate. `null`
   * se non c'è una root aperta, se `relativePath` esce dalla root
   * (path traversal) o se il percorso risultante non è leggibile come
   * cartella.
   */
  async listDirectory(relativePath: string): Promise<ProjectEntry[] | null> {
    if (this.rootPath === null) return null;
    const target = resolveWithinRoot(this.rootPath, relativePath);
    if (target === null) return null;

    let dirents;
    try {
      dirents = await fsp.readdir(target, { withFileTypes: true });
    } catch {
      return null;
    }

    return dirents
      .filter((entry) => !DEFAULT_IGNORED_NAMES.has(entry.name))
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }
}
