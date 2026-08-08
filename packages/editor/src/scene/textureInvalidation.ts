import { PROJECT_TREE_ROOT_PATH } from "../panels/projectTreeState.js";

/**
 * textureInvalidation.ts — Fase 11B.2 (punto aperto 5 confermato, deferito
 * da 11B.1): logica pura (nessun accesso a store/rete/DOM, per essere
 * testata senza mock) che collega le notifiche del canale watch
 * `/project/watch` (Fase 10G, `projectFolderClient.ts`) alle texture
 * attualmente in cache in `@engine/core` (`cachedTexturePaths`), per
 * decidere quali vanno passate a `invalidateTexture`.
 *
 * Vincolo architetturale verificato sul codice reale lato host-agent
 * (`packages/host-agent/src/projectFolder.ts`, `queueChangedPath`): il
 * canale watch segnala CARTELLE cambiate (`path.posix.dirname(...)` del
 * file toccato), MAI il singolo file — stessa granularità già sfruttata da
 * `changedPathsToReload` in `projectTreeState.ts` per l'albero. Per capire
 * se una texture in cache va invalidata, serve quindi calcolare la
 * cartella-genitore del suo percorso e confrontarla con le cartelle
 * segnalate come cambiate — non un confronto diretto percorso-per-percorso.
 */

/**
 * Cartella-genitore di un percorso relativo di FILE (es. una texture in
 * cache), nella stessa convenzione POSIX del canale watch: `"."`
 * (`PROJECT_TREE_ROOT_PATH`) per un file di primo livello, non `null` —
 * a differenza di `parentProjectPath` in `projectTreeState.ts` (pensata per
 * la risalita di una CARTELLA nella griglia, dove `null` = "esci dalla
 * griglia"): qui serve poter confrontare direttamente il risultato con gli
 * elementi di `changedPaths`, che usano sempre `"."` per la root, mai
 * `null`.
 */
function textureFolderPath(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf("/");
  return lastSlash === -1 ? PROJECT_TREE_ROOT_PATH : relativePath.slice(0, lastSlash);
}

/**
 * texturePathsAffectedByChange — dati i percorsi di cartella segnalati come
 * cambiati dal watch (`changedPaths`, stile POSIX, `"."` per la root) e i
 * percorsi di texture attualmente in cache (`cachedPaths`,
 * `cachedTexturePaths()` in `@engine/core`), restituisce quali fra questi
 * ultimi vanno invalidati ORA: quelli la cui cartella-genitore compare fra
 * `changedPaths`. Non è invece un problema stabilire QUALE file dentro
 * quella cartella sia cambiato — `invalidateTexture` (core) ricarica e basta,
 * un ricaricamento in più per una texture che in realtà non è cambiata (un
 * altro file nella stessa cartella è stato toccato) è un costo accettabile,
 * nessun falso negativo è invece accettabile (texture rimasta stantia).
 */
export function texturePathsAffectedByChange(changedPaths: readonly string[], cachedPaths: readonly string[]): string[] {
  const changedSet = new Set(changedPaths);
  return cachedPaths.filter((texturePath) => changedSet.has(textureFolderPath(texturePath)));
}
