import type { MeshShape } from "../rendering/MeshRenderer.js";
import type { LightKind } from "../rendering/Light.js";
import type { RigidBodyType } from "../physics/RigidBody.js";

/**
 * Formato dati per la serializzazione di scene/prefab (Fase 5).
 *
 * Deliberatamente un albero annidato (`GameObjectData.children`), non una
 * lista piatta con `parentId` da risolvere: il modello nativo di
 * Transform/Object3D è già un albero (vedi `Transform.setParent`), quindi
 * appiattirlo aggiungerebbe solo un passo di risoluzione riferimenti senza
 * benefici per questa fase. Nessun componente attuale (MeshRenderer,
 * RigidBody, Collider) referenzia un altro GameObject — se in futuro ne
 * servisse uno (es. un Joint fisico fra due RigidBody), l'`id` già presente
 * su ogni `GameObjectData` è sufficiente per aggiungere quel riferimento
 * senza cambiare questo schema.
 *
 * I tipi dei campi dei componenti (`MeshShape`, `RigidBodyType`) sono
 * IMPORTATI dai moduli runtime che li possiedono invece di essere
 * ridichiarati qui: sono già forme dati semplici (stringhe/numeri/oggetti
 * letterali), quindi duplicarli in un tipo "Data" parallelo introdurrebbe
 * solo un rischio di disallineamento silenzioso se uno dei due cambia senza
 * l'altro.
 */

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionData {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface TransformData {
  position: Vector3Data;
  /**
   * Quaternion, non euler: è la fonte di verità interna di Transform (vedi
   * `Transform.rotation`, delegato a `Object3D.quaternion`) — serializzare
   * gli euler introdurrebbe una conversione non necessaria e con rischio di
   * gimbal lock/ambiguità di ordine assi che il quaternion evita.
   */
  rotation: QuaternionData;
  scale: Vector3Data;
}

export interface MeshRendererData {
  type: "MeshRenderer";
  shape: MeshShape;
  color: number;
  /**
   * Fase 11 — metalness/roughness (0-1, metallic/roughness workflow).
   * Opzionali (a differenza di `shape`/`color`, sempre presenti fin dalla
   * Fase 5): una scena salvata PRIMA di Fase 11 non li ha nel JSON su disco,
   * e `deserializeScene`/`applyComponentData` non fanno validazione a runtime
   * di questo formato (vedi SceneSerializer.ts) — quindi il campo può
   * arrivare `undefined` anche se qui il tipo lo dichiara `number`. Un
   * MeshRenderer appena serializzato li scrive SEMPRE (stesso trattamento di
   * `color`): l'opzionalità è solo per leggere dati vecchi, non per ometterli
   * quando si scrive. Stesso principio già seguito per `sourceAssetId?` in
   * `GameObjectData` sotto.
   */
  metalness?: number;
  roughness?: number;
}

/**
 * Campo chiamato `lightKind` (non `kind`) per lo stesso motivo per cui
 * `RigidBodyData` chiama il proprio campo `bodyType` invece di `type`:
 * `type` qui è già il discriminante di `ComponentData` stesso ("Light"),
 * quindi il campo che rispecchia `Light.kind` sul componente ha bisogno di
 * un nome diverso per non fare ombra al discriminante.
 */
export interface LightData {
  type: "Light";
  lightKind: LightKind;
  color: number;
  intensity: number;
}

export interface RigidBodyData {
  type: "RigidBody";
  bodyType: RigidBodyType;
  gravityScale: number;
}

export interface BoxColliderData {
  type: "BoxCollider";
  size: Vector3Data;
  friction: number;
  restitution: number;
  isTrigger: boolean;
}

export interface SphereColliderData {
  type: "SphereCollider";
  radius: number;
  friction: number;
  restitution: number;
  isTrigger: boolean;
}

/**
 * Union discriminata su `type`. Aggiungere un nuovo componente serializzabile
 * significa: aggiungere un membro qui, un caso nello switch esaustivo di
 * `serializeComponent`, e un caso nello switch esaustivo di
 * `applyComponentData` (SceneSerializer.ts) — il controllo di esaustività
 * TypeScript in entrambi gli switch fa fallire la build se se ne dimentica uno.
 */
export type ComponentData = MeshRendererData | LightData | RigidBodyData | BoxColliderData | SphereColliderData;

/**
 * Alias per il discriminante di `ComponentData` (Fase 6D). Nome
 * deliberatamente diverso sia da `GameObjectKind` (messages.ts/
 * collabClient.ts, che discrimina empty/box/sphere/plane) sia da
 * `ComponentType<T>` (core/Component.ts, un tipo COSTRUTTORE usato da
 * `addComponent`, concetto non correlato) — per non creare ambiguità fra i
 * tre nello stesso codebase.
 */
export type ComponentTypeName = ComponentData["type"];

export interface GameObjectData {
  id: string;
  name: string;
  active: boolean;
  transform: TransformData;
  components: ComponentData[];
  children: GameObjectData[];
  /**
   * Fase 7 — id nell'asset store dell'editor (packages/editor/src/
   * persistence/AssetPersistence.ts) del modello GLTF/GLB da cui questo
   * GameObject è stato istanziato, se presente. Opzionale e assente per
   * ogni GameObject "normale" (primitive MeshRenderer, luci, ecc.): non un
   * componente, perché non descrive uno stato del GameObject stesso ma la
   * PROVENIENZA della sua gerarchia three.js — che non passa da
   * `components`/`children` (i figli three.js importati da un GLTF non
   * sono GameObject, vedi il filtro `userData["__gameObject"]` in
   * SceneSerializer.ts) e quindi non sarebbe altrimenti ricostruibile da
   * un SceneData salvato. La ricostruzione vera e propria (rifetch
   * dell'asset binario + riattacco della gerarchia three.js) è
   * responsabilità dell'editor, non di questo modulo (core non ha accesso
   * a IndexedDB/fetch) — vedi `attachGLTF` in rendering/AssetLoader.ts.
   */
  sourceAssetId?: string;
}

/**
 * Formato radice di una scena serializzata. `version` è per migrazioni
 * future del FORMATO (struttura dello schema), non per il contenuto della
 * scena — un numero letterale (non `number`) così `deserializeScene` può
 * fare un controllo di uguaglianza tipizzato invece di un confronto generico.
 */
export interface SceneData {
  version: 1;
  roots: GameObjectData[];
}
