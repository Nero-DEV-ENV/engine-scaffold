import type { TransformData, ComponentData, ComponentTypeName } from "@engine/core";

/**
 * messages.ts — payload e validazione dei messaggi client→server. File
 * separato (non inline in EditorRoom.ts) perché ogni fase aggiunge qui i
 * propri tipi di messaggio seguendo lo stesso pattern: `addGameObject`/
 * `removeGameObject` (Fase 6C.2) sono qui sotto; 6D aggiungerà `addComponent`
 * con lo stesso approccio.
 *
 * Validazione manuale (non Zod, che pure è già peer dependency di
 * @colyseus/core e supportata nativamente da `onMessage` in 0.17 via
 * `validate()`): tenuta minimale per non allargare la superficie di questa
 * fase — da rivalutare in una eventuale fase di hardening dedicata, stesso
 * pattern già seguito con Fase 5C rispetto a 5A/5B.
 */

/**
 * Fase 6D estende ogni entry di `gameObjects` con `components`: i
 * componenti CORRENTI di quel GameObject locale al momento dell'hydrate
 * (stessa idempotenza già applicata a `id`/`transform` — vedi
 * `removedComponentKeys` in EditorRoom.ts).
 */
export interface HydrateSceneMessage {
  gameObjects: Array<{ id: string; transform: TransformData; components: ComponentData[] }>;
}

export interface CommitTransformMessage {
  gameObjectId: string;
  transform: TransformData;
}

/**
 * beginEdit/endEdit — Fase 6B.client-2: lock ottimistico di editing,
 * agganciato allo stesso hook `dragging-changed` che già invia
 * `commitTransform` (vedi createEditorScene.ts). Stessa forma minima per
 * entrambi (solo `gameObjectId`): la semantica del lock (chi vince, chi può
 * rilasciarlo) vive in EditorRoom.ts, non qui.
 */
export interface BeginEditMessage {
  gameObjectId: string;
}

export interface EndEditMessage {
  gameObjectId: string;
}

/**
 * addGameObject/removeGameObject — Fase 6C.2: sync collaborativo
 * dell'aggiunta/rimozione di un GameObject. `id` è generato dal CLIENT
 * (ottimistico — vedi createEditorScene.ts, stesso approccio già usato per
 * gli id degli oggetti hydratati); il server resta autoritativo perché
 * EditorRoom.ts rifiuta un id già presente. `kind` rispecchia le quattro
 * primitive supportate da `EditorSceneHandle.addGameObject` (Fase 6C.1) —
 * nessun "Add Component" generico, quello resta 6D.
 */
export type GameObjectKind = "empty" | "box" | "sphere" | "plane";

/**
 * `components` (Fase 6D, opzionale — retro-compatibile con 6C.2): i
 * componenti che il GameObject porta già alla creazione (es. il
 * MeshRenderer di default per Cube/Sphere/Plane, vedi
 * `shapeForKind`/`addGameObject` in createEditorScene.ts). Sincronizzarli
 * nello STESSO messaggio invece di un `addComponent` separato subito dopo
 * evita una finestra in cui il GameObject esiste già in `transforms` ma i
 * suoi componenti di default non sono ancora in `components` — e tiene
 * `components` come UNICA fonte di verità su quali componenti esistono,
 * senza distinguere "auto-aggiunto da kind" da "aggiunto esplicitamente
 * dall'utente".
 */
export interface AddGameObjectMessage {
  id: string;
  kind: GameObjectKind;
  name: string;
  transform: TransformData;
  components?: ComponentData[];
}

export interface RemoveGameObjectMessage {
  gameObjectId: string;
}

/**
 * gameObjectsRemoved — Fase 6C.2 (fix): risposta MIRATA (client.send, non
 * broadcast) del server al SOLO client che ha appena inviato `hydrateScene`,
 * elencando gli id che quel client ha provato a hydratare ma che sono
 * risultati già rimossi definitivamente (`removedGameObjectIds` in
 * EditorRoom.ts). Scoperto con uno smoke-test reale: senza questo
 * messaggio, un client che si connette DOPO che un oggetto pre-esistente è
 * stato rimosso non ha alcun modo di saperlo — la sua copia locale
 * dell'oggetto (bootstrap hardcoded, indipendente dalla rete) resta
 * visibile per sempre, perché `transforms.onRemove` scatta solo per una
 * transizione presente→assente osservata DOPO la connessione, non per uno
 * stato già assente al momento del join.
 */
export interface GameObjectsRemovedMessage {
  gameObjectIds: string[];
}

/**
 * addComponent/removeComponent/updateComponent — Fase 6D: sync di
 * aggiunta/rimozione/modifica di un componente su un GameObject già
 * esistente. Nessun id proprio per il componente: la coppia
 * (gameObjectId, type) è già univoca per costruzione (GameObject.addComponent
 * vieta due componenti dello stesso tipo esatto — vedi core/GameObject.ts),
 * la stessa chiave composita è usata lato server per
 * `EditorRoomState.components` (vedi `componentKey` in EditorRoomState.ts).
 *
 * `addComponent` e `updateComponent` condividono la stessa forma
 * (gameObjectId + ComponentData completo) ma hanno semantica opposta lato
 * server: `addComponent` fallisce silenziosamente se il tipo esiste già
 * (mirror di `GameObject.addComponent`), `updateComponent` fallisce
 * silenziosamente se NON esiste ancora — stesso stile "richiesta ignorata
 * silenziosamente su intent non valido" già usato ovunque in EditorRoom.ts.
 */
export interface AddComponentMessage {
  gameObjectId: string;
  component: ComponentData;
}

export interface RemoveComponentMessage {
  gameObjectId: string;
  type: ComponentTypeName;
}

export interface UpdateComponentMessage {
  gameObjectId: string;
  component: ComponentData;
}

/**
 * componentsRemoved — Fase 6D (stesso fix di `gameObjectsRemoved` sopra,
 * stesso motivo esatto): risposta MIRATA del server al SOLO client che ha
 * appena inviato `hydrateScene`, elencando le chiavi composite
 * (`gameObjectId:type`) dei componenti che quel client ha provato a
 * hydratare ma che sono risultati già rimossi definitivamente
 * (`removedComponentKeys` in EditorRoom.ts) — senza questo messaggio, la
 * copia locale fantasma di quel componente (bootstrap hardcoded,
 * indipendente dalla rete) resterebbe visibile per sempre.
 */
export interface ComponentsRemovedMessage {
  componentKeys: string[];
}

/**
 * publishManifestEntries — Fase 10E: pubblica/ripubblica il manifest di UN
 * livello di cartella (`parentPath`, `MANIFEST_ROOT_PATH` per la root —
 * vedi `schema/EditorRoomState.ts`) della project folder. Ogni chiamata è
 * un DIFF COMPLETO di quel livello: `entries` è la lista corrente e
 * completa di quanto trovato da `listDirectory` lato host-agent per quel
 * percorso (mai un delta/aggiunta incrementale) — `EditorRoom.ts` calcola
 * da qui cosa aggiungere/aggiornare/rimuovere. Nessun campo `gameObjectId`-
 * equivalente per il mittente: nessuna autorità/proprietà del livello
 * pubblicato (vedi JSDoc di `ManifestEntryState`), quindi il server non ha
 * bisogno di sapere CHI ha pubblicato, solo COSA.
 */
export interface PublishManifestEntriesMessage {
  parentPath: string;
  entries: Array<{ name: string; kind: "file" | "directory" }>;
}

const GAME_OBJECT_KINDS = new Set<GameObjectKind>(["empty", "box", "sphere", "plane"]);

function isGameObjectKind(value: unknown): value is GameObjectKind {
  return typeof value === "string" && GAME_OBJECT_KINDS.has(value as GameObjectKind);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVector3Data(value: unknown): value is TransformData["position"] {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

function isQuaternionData(value: unknown): value is TransformData["rotation"] {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isVector3Data(value) && isFiniteNumber(v.w);
}

export function isTransformData(value: unknown): value is TransformData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isVector3Data(v.position) && isQuaternionData(v.rotation) && isVector3Data(v.scale);
}

/**
 * Validatori per `ComponentData` (Fase 6D) — puramente strutturali, senza
 * importare i tipi `MeshShape`/`LightKind`/`RigidBodyType` da
 * `@engine/core` (stesso stile già usato da `isTransformData` sopra, che
 * non importa `TransformData` per validarne la forma). `shape`/`lightKind`
 * sono a loro volta union discriminate annidate — validate qui per intero
 * anche se l'Inspector (Fase 6D) non le espone come editabili: un
 * MeshRenderer/Light richiede comunque questi campi per essere costruito
 * alla creazione (vedi `applyComponentData` in SceneSerializer.ts).
 */
const MESH_SHAPE_KINDS = new Set(["box", "sphere", "plane"]);

function isMeshShapeData(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!MESH_SHAPE_KINDS.has(v.kind as string)) return false;
  switch (v.kind) {
    case "box":
      return isVector3Data(v.size);
    case "sphere":
      return isFiniteNumber(v.radius);
    case "plane":
      return isFiniteNumber(v.width) && isFiniteNumber(v.height);
    default:
      return false;
  }
}

const LIGHT_KIND_KINDS = new Set(["ambient", "directional"]);

function isLightKindData(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!LIGHT_KIND_KINDS.has(v.kind as string)) return false;
  switch (v.kind) {
    case "ambient":
      return true;
    case "directional":
      return isVector3Data(v.position);
    default:
      return false;
  }
}

const RIGID_BODY_TYPE_VALUES = new Set(["dynamic", "kinematic", "fixed"]);

function isRigidBodyTypeValue(value: unknown): boolean {
  return typeof value === "string" && RIGID_BODY_TYPE_VALUES.has(value);
}

const COMPONENT_TYPE_NAMES = new Set<ComponentTypeName>([
  "MeshRenderer",
  "Light",
  "RigidBody",
  "BoxCollider",
  "SphereCollider",
]);

function isComponentTypeName(value: unknown): value is ComponentTypeName {
  return typeof value === "string" && COMPONENT_TYPE_NAMES.has(value as ComponentTypeName);
}

export function isComponentData(value: unknown): value is ComponentData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const type = v.type;
  if (!isComponentTypeName(type)) return false;
  switch (type) {
    case "MeshRenderer":
      return isMeshShapeData(v.shape) && isFiniteNumber(v.color);
    case "Light":
      return isLightKindData(v.lightKind) && isFiniteNumber(v.color) && isFiniteNumber(v.intensity);
    case "RigidBody":
      return isRigidBodyTypeValue(v.bodyType) && isFiniteNumber(v.gravityScale);
    case "BoxCollider":
      return (
        isVector3Data(v.size) &&
        isFiniteNumber(v.friction) &&
        isFiniteNumber(v.restitution) &&
        typeof v.isTrigger === "boolean"
      );
    case "SphereCollider":
      return (
        isFiniteNumber(v.radius) &&
        isFiniteNumber(v.friction) &&
        isFiniteNumber(v.restitution) &&
        typeof v.isTrigger === "boolean"
      );
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function isCommitTransformMessage(value: unknown): value is CommitTransformMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.gameObjectId === "string" && v.gameObjectId.length > 0 && isTransformData(v.transform);
}

export function isHydrateSceneMessage(value: unknown): value is HydrateSceneMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.gameObjects)) return false;
  return v.gameObjects.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e.id === "string" &&
      e.id.length > 0 &&
      isTransformData(e.transform) &&
      Array.isArray(e.components) &&
      e.components.every(isComponentData)
    );
  });
}

function hasNonEmptyGameObjectId(value: unknown): value is { gameObjectId: string } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.gameObjectId === "string" && v.gameObjectId.length > 0;
}

export function isBeginEditMessage(value: unknown): value is BeginEditMessage {
  return hasNonEmptyGameObjectId(value);
}

export function isEndEditMessage(value: unknown): value is EndEditMessage {
  return hasNonEmptyGameObjectId(value);
}

export function isAddGameObjectMessage(value: unknown): value is AddGameObjectMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    !(
      typeof v.id === "string" &&
      v.id.length > 0 &&
      isGameObjectKind(v.kind) &&
      typeof v.name === "string" &&
      isTransformData(v.transform)
    )
  ) {
    return false;
  }
  // `components` è opzionale (retro-compatibile con 6C.2, vedi JSDoc del
  // tipo sopra) — se presente dev'essere un array di ComponentData validi.
  return v.components === undefined || (Array.isArray(v.components) && v.components.every(isComponentData));
}

export function isRemoveGameObjectMessage(value: unknown): value is RemoveGameObjectMessage {
  return hasNonEmptyGameObjectId(value);
}

/**
 * Validatori per i messaggi componente (Fase 6D) — `addComponent`/
 * `updateComponent` condividono la stessa forma (vedi JSDoc di
 * `AddComponentMessage` in cima al file), quindi un unico helper
 * `isGameObjectIdWithComponent` basta per entrambi.
 */
function isGameObjectIdWithComponent(value: unknown): value is { gameObjectId: string; component: ComponentData } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.gameObjectId === "string" && v.gameObjectId.length > 0 && isComponentData(v.component);
}

export function isAddComponentMessage(value: unknown): value is AddComponentMessage {
  return isGameObjectIdWithComponent(value);
}

export function isUpdateComponentMessage(value: unknown): value is UpdateComponentMessage {
  return isGameObjectIdWithComponent(value);
}

export function isRemoveComponentMessage(value: unknown): value is RemoveComponentMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.gameObjectId === "string" && v.gameObjectId.length > 0 && isComponentTypeName(v.type);
}

/** Validatore per una singola entry di `PublishManifestEntriesMessage.entries` (Fase 10E) — stessa forma di `ProjectEntry` lato host-agent/editor. */
function isManifestEntryData(value: unknown): value is { name: string; kind: "file" | "directory" } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && v.name.length > 0 && (v.kind === "file" || v.kind === "directory");
}

export function isPublishManifestEntriesMessage(value: unknown): value is PublishManifestEntriesMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.parentPath === "string" &&
    v.parentPath.length > 0 &&
    Array.isArray(v.entries) &&
    v.entries.every(isManifestEntryData)
  );
}
