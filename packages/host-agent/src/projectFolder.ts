import { promises as fsp, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "chokidar";

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
 * Fase 10G — la sessione ora estende `EventEmitter` (evento "changed",
 * vedi `restartWatching()` più sotto): un consumer real-time esiste
 * finalmente (canale WS dedicato `/project/watch` in httpServer.ts), a
 * differenza di quando questo file è stato scritto in Fase 10A.
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

export interface ProjectFolderSessionOptions {
  /**
   * Fase 10D — percorso assoluto del file JSON usato per persistere
   * `rootPath` fra riavvii del PROCESSO host-agent (vedi `restore()`).
   * Se omesso (default), nessuna persistenza: la sessione si comporta
   * esattamente come nelle fasi precedenti, solo in memoria — questo
   * mantiene invariati tutti i test già esistenti che istanziano
   * `new ProjectFolderSession()` senza argomenti. Iniettato dal chiamante
   * (`index.ts`, con `PROJECT_FOLDER_STATE_PATH` da `paths.ts`) invece di
   * calcolato qui dentro, per restare testabile su fixture reali
   * (`mkdtempSync`) senza mai toccare il vero percorso di produzione.
   */
  statePath?: string;
  /**
   * Fase 10G — finestra di debounce (ms) usata da `startWatching()` per
   * raggruppare raffiche di eventi filesystem ravvicinati (es. un `git
   * pull` che tocca decine di file in pochi millisecondi) in un'unica
   * emissione `"changed"`. Default 300ms. Iniettabile per gli stessi
   * motivi di `statePath`: i test di questo file usano un valore piccolo
   * per restare veloci, senza toccare la costante di produzione.
   */
  watchDebounceMs?: number;
}

/** Fase 10G — payload dell'evento `"changed"`: percorsi RELATIVI alla root (stile POSIX, "." per la root stessa, coerente con `PROJECT_TREE_ROOT_PATH` lato editor) delle cartelle il cui contenuto è cambiato. Deduplicati e raggruppati per finestra di debounce — vedi `queueChangedPath()`. */
export interface ProjectChangeEvent {
  changedPaths: string[];
}

const DEFAULT_WATCH_DEBOUNCE_MS = 300;

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

export class ProjectFolderSession extends EventEmitter {
  private rootPath: string | null = null;
  private readonly statePath: string | null;
  private readonly watchDebounceMs: number;

  /** Fase 10G — `null` se nessuna root è aperta (o se il watch è stato appena fermato). Un solo watcher alla volta, coerente col vincolo "una sola root aperta" già valido per l'intera sessione. */
  private watcher: FSWatcher | null = null;
  /** Fase 10G — cartelle (percorsi relativi POSIX) toccate da un evento filesystem ancora da "flushare" come evento `"changed"` — vedi `queueChangedPath()`/`flushChangedPaths()`. */
  private readonly pendingChangedPaths = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ProjectFolderSessionOptions = {}) {
    super();
    this.statePath = options.statePath ?? null;
    this.watchDebounceMs = options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
  }

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
    this.persistState();
    this.restartWatching();
    return { ok: true };
  }

  /** Chiude la project root corrente, se presente. Restituisce `false` se non ce n'era una aperta (stesso pattern 202/409 già usato da ProcessSupervisor.stop()/TunnelHostSession.close()). */
  closeRoot(): boolean {
    if (this.rootPath === null) return false;
    this.rootPath = null;
    this.persistState();
    this.stopWatching();
    return true;
  }

  getState(): ProjectFolderState {
    return { rootPath: this.rootPath };
  }

  /**
   * Fase 10G — ferma un watcher eventualmente già attivo (root sostituita
   * o chiusa) e ne avvia uno nuovo sulla root corrente, se presente.
   * Chiamato da `openRoot()` (mai più di un watcher alla volta, stesso
   * vincolo "una sola root" già valido per il resto della sessione) e
   * indirettamente da `restore()` (che riusa `openRoot()`).
   */
  private restartWatching(): void {
    this.stopWatching();
    if (this.rootPath === null) return;
    const root = this.rootPath;

    // `persistent: false`: non deve essere QUESTO watcher a tenere vivo il
    // processo — in produzione ci pensa già il server HTTP (`server.listen()`
    // in httpServer.ts/index.ts). Scelta deliberata anche per i test: molti
    // test esistenti in questo file aprono una root senza mai chiamarla
    // (`closeRoot()`) esplicitamente; con `persistent: true` (default di
    // chokidar) ognuno di quei watcher lascerebbe un handle aperto che
    // impedirebbe a Vitest di terminare pulito a fine file.
    //
    // `ignoreInitial: true`: la scansione iniziale di chokidar non deve
    // generare un'ondata di eventi "add"/"addDir" per l'intero albero già
    // esistente al momento dell'apertura — solo i cambiamenti SUCCESSIVI
    // interessano questa fase (vedi obiettivo dichiarato).
    //
    // `ignored`: stessa esclusione già applicata a `listDirectory()`
    // (`DEFAULT_IGNORED_NAMES`, confrontata sul nome base) — qui però
    // chokidar la usa anche per NON scendere affatto dentro quelle
    // cartelle durante la scansione/il watch, non solo per filtrare
    // l'output a posteriori.
    this.watcher = watch(root, {
      persistent: false,
      ignoreInitial: true,
      ignored: (watchedPath: string) => DEFAULT_IGNORED_NAMES.has(path.basename(watchedPath)),
    });

    const onEntryEvent = (absolutePath: string): void => this.queueChangedPath(root, absolutePath);
    // Fase 10G — solo add/unlink/addDir/unlinkDir in origine: un "change"
    // (contenuto di un file modificato, es. scene.json riscritto da un
    // altro strumento) non altera l'elenco di una cartella — nessuna
    // entry aggiunta/rimossa — quindi non serviva invalidare/ripubblicare
    // nulla per Fase 10E/10B con quello scope. Punto confermato
    // dall'utente all'epoca: nessuna gestione speciale per scene.json
    // cambiato dall'esterno in quella fase.
    //
    // Fase 11B.2 — "change" AGGIUNTO: l'invalidazione automatica delle
    // texture (AssetLoader.invalidateTexture, agganciata a questo stesso
    // canale via projectFolderClient.ts) dipende esattamente dal caso che
    // Fase 10G escludeva di proposito — sovrascrivere un file ESISTENTE
    // (stesso nome) con un nuovo contenuto è quasi sempre un "change", non
    // un add/unlink. Bug scoperto in smoke-test: senza questo listener,
    // l'invalidazione funzionava per puro caso solo se lo strumento
    // esterno cancellava e ricreava il file (unlink+add) invece di
    // sovrascriverlo in-place. Nessun danno per l'uso originale di Fase
    // 10E/10B: un reload in più della lista cartella per un "change" che
    // non altera l'elenco è innocuo (idempotente), la stessa
    // deduplicazione per finestra di debounce già esistente si applica
    // identica a questo evento.
    this.watcher.on("add", onEntryEvent);
    this.watcher.on("unlink", onEntryEvent);
    this.watcher.on("addDir", onEntryEvent);
    this.watcher.on("unlinkDir", onEntryEvent);
    this.watcher.on("change", onEntryEvent);
  }

  /** Fase 10G — ferma il watcher corrente (se presente) e scarta qualunque cambiamento ancora in attesa di essere "flushato" — un cambiamento nella root appena chiusa non deve generare una notifica tardiva dopo la chiusura. */
  private stopWatching(): void {
    if (this.watcher !== null) {
      const activeWatcher = this.watcher;
      this.watcher = null;
      void activeWatcher.close();
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChangedPaths.clear();
  }

  /**
   * Fase 10G — converte `absolutePath` (separatori nativi del SO, es.
   * backslash su Windows) nel percorso RELATIVO stile POSIX della
   * cartella che lo contiene, e lo accoda per la prossima emissione
   * `"changed"`. `path.posix.dirname(...)` calcola sempre il genitore
   * corretto sia che `absolutePath` sia un file sia una cartella: in
   * entrambi i casi è la cartella GENITORE a dover essere ricaricata
   * (un file/cartella in più o in meno cambia l'elenco del genitore, non
   * il proprio); `""` (la root stessa cambiata, es. `addDir` sulla root
   * durante uno scenario limite) è normalizzato a `"."`, coerente con
   * `PROJECT_TREE_ROOT_PATH` lato editor.
   */
  private queueChangedPath(root: string, absolutePath: string): void {
    const relative = path.relative(root, absolutePath).split(path.sep).join("/");
    const affectedDir = relative === "" ? "." : path.posix.dirname(relative);
    this.pendingChangedPaths.add(affectedDir);

    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flushChangedPaths(), this.watchDebounceMs);
  }

  /** Fase 10G — emette un solo evento `"changed"` con TUTTE le cartelle accodate dall'ultimo flush (deduplicate dal `Set`), poi svuota la coda. Non-op se non c'è nulla in coda (es. il timer scatta dopo che `stopWatching()` ha già svuotato tutto). */
  private flushChangedPaths(): void {
    this.debounceTimer = null;
    if (this.pendingChangedPaths.size === 0) return;
    const changedPaths = [...this.pendingChangedPaths];
    this.pendingChangedPaths.clear();
    this.emit("changed", { changedPaths } satisfies ProjectChangeEvent);
  }

  /**
   * Fase 10D — rilegge, se presente, l'ultima root nota da `statePath` e
   * prova a riaprirla SUBITO E SILENZIOSAMENTE (nessuna azione utente
   * richiesta) — pensata per essere chiamata UNA VOLTA da `index.ts`
   * all'avvio del processo, prima di accettare richieste HTTP. Fallisce
   * silenziosamente (la sessione resta con `rootPath: null`, nessuna
   * eccezione propagata) se: `statePath` non è configurato (nessuna
   * persistenza, vedi costruttore), il file non esiste ancora (primo
   * avvio in assoluto), il suo contenuto non è JSON valido o non ha la
   * shape attesa, oppure il percorso salvato non esiste più su disco
   * (cartella spostata/rimossa/USB scollegata) — stesso trattamento
   * "richiesta ignorata" già usato altrove (es. `readFile` su un percorso
   * invalido, Fase 10C). Riusa `openRoot()` per la validazione invece di
   * duplicarla, quindi ripersiste anche lo stesso stato appena letto
   * (idempotente, innocuo).
   */
  restore(): void {
    if (this.statePath === null) return;
    let raw: string;
    try {
      raw = readFileSync(this.statePath, "utf8");
    } catch {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const savedRootPath = (parsed as { rootPath?: unknown }).rootPath;
    if (typeof savedRootPath !== "string") return;
    this.openRoot(savedRootPath);
  }

  /**
   * Scrive lo stato corrente su `statePath` (no-op se non configurato) —
   * chiamata SINCRONAMENTE da `openRoot()`/`closeRoot()` subito dopo aver
   * cambiato `rootPath`, quindi completata prima che quei metodi tornino
   * al chiamante HTTP che li ha innescati (punto confermato per Fase
   * 10D): un crash improvviso del processo (kill -9, crash di sistema)
   * non deve poter perdere l'ultima root nota, quindi non ci si può
   * affidare a un handler di chiusura pulita tipo `process.on('exit',
   * ...)`, inaffidabile in quei casi. Fallisce silenziosamente se la
   * scrittura non riesce (es. permessi, disco pieno): lo stato in memoria
   * di questa sessione resta comunque coerente, solo la persistenza fra
   * riavvii ne risentirebbe.
   */
  private persistState(): void {
    if (this.statePath === null) return;
    try {
      mkdirSync(path.dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, JSON.stringify({ rootPath: this.rootPath }), "utf8");
    } catch {
      // Vedi commento sopra: fallimento silenzioso, per design.
    }
  }

  /**
   * Legge i byte grezzi di un file dentro la project root corrente (Fase
   * 10C — serve i modelli/texture scelti nell'albero/griglia all'editor,
   * che prima di questa fase importava SOLO da `<input type="file">`).
   * Stessa guardia anti path-traversal di `listDirectory`
   * (`resolveWithinRoot`). `null` se: nessuna root aperta, `relativePath`
   * esce dalla root, il percorso non esiste, o risulta essere una cartella
   * e non un file — leggere una cartella come file è un intent non valido,
   * stesso trattamento "richiesta ignorata" già usato altrove (es.
   * `removeGameObject` su un id sconosciuto in EditorRoom.ts).
   */
  async readFile(relativePath: string): Promise<Buffer | null> {
    if (this.rootPath === null) return null;
    const target = resolveWithinRoot(this.rootPath, relativePath);
    if (target === null) return null;

    let stats;
    try {
      stats = await fsp.stat(target);
    } catch {
      return null;
    }
    if (!stats.isFile()) return null;

    try {
      return await fsp.readFile(target);
    } catch {
      return null;
    }
  }

  /**
   * Fase 10F — scrive `contents` (testo UTF-8, il JSON di `SceneData` nel
   * caso d'uso attuale) in `relativePath` dentro la project root corrente,
   * sovrascrivendo un file già esistente. Stessa guardia anti-traversal di
   * `readFile`/`listDirectory` (`resolveWithinRoot`). `false` se: nessuna
   * root è aperta, `relativePath` esce dalla root, il percorso risultante è
   * già una cartella (scrivere un file sopra una cartella non è un intent
   * valido — stesso trattamento "richiesta ignorata" già usato altrove), o
   * la scrittura fallisce per un motivo di filesystem (permessi, disco
   * pieno). Nessuna creazione di cartelle intermedie: a differenza di
   * `persistState()` (stato interno di host-agent, può vivere ovunque sotto
   * `.host-agent-state/`), qui il percorso è dentro la project folder
   * dell'utente — la Fase 10F v1 usa solo un percorso fisso alla radice
   * (`scene.json`), che esiste già in quanto la radice stessa è aperta;
   * creare sottocartelle mancanti in una fase futura che permettesse un
   * percorso scelto dall'utente è una decisione a parte, non presa qui.
   *
   * Fase 11B.2 — da quando il watcher ascolta anche "change" (vedi
   * `startWatching()`), sovrascrivere `scene.json` qui genera ora ANCHE una
   * notifica sul canale `/project/watch` (percorso della root, "."),
   * innocua: solo un reload idempotente della lista root lato editor,
   * nessun ciclo di salvataggio o comportamento diverso da prima.
   */
  async writeFile(relativePath: string, contents: string): Promise<boolean> {
    if (this.rootPath === null) return false;
    const target = resolveWithinRoot(this.rootPath, relativePath);
    if (target === null) return false;

    try {
      const stats = await fsp.stat(target);
      if (stats.isDirectory()) return false;
    } catch {
      // Il file non esiste ancora: va bene, è una creazione, non una
      // sovrascrittura — nessun errore da questo stat().
    }

    try {
      await fsp.writeFile(target, contents, "utf8");
      return true;
    } catch {
      return false;
    }
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
