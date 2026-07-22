import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { RigidBody } from "./RigidBody.js";
import type { Collider } from "./Collider.js";

/**
 * Physics — modulo a stato di modulo (stesso pattern di Scene.ts) che possiede il
 * `RAPIER.World` condiviso e fa da bridge tra il game loop dell'Engine e Rapier.
 *
 * Scelta del package: `@dimforge/rapier3d-compat` invece di `@dimforge/rapier3d`.
 * La variante "compat" inlinea il binario WASM come base64 direttamente nel bundle
 * JS (verificato: `rapier.mjs` non richiede alcun fetch() di un file `.wasm` a parte —
 * l'ho controllato scompattando il pacchetto npm prima di sceglierlo). La variante non-compat
 * invece fa un fetch() runtime di un file `.wasm` separato, il che richiederebbe configurare
 * il Content-Type `application/wasm` sul server di hosting (Nginx/Caddy sulle VPS Hetzner) e
 * introduce una classe di bug interamente evitabile (MIME type sbagliato, path relativo rotto
 * dopo il deploy, problemi di streaming instantiation). La versione compat costa più peso nel
 * bundle (il base64 è ~33% più grande del binario) ma elimina completamente quella superficie
 * di rischio — scelta corretta per un motore open source che chiunque deve poter clonare e
 * buildare senza configurazione server particolare. Come bonus, questo è anche ciò che rende
 * possibile testare RigidBody/Collider in Vitest (Node) senza mock: WebAssembly.instantiate su
 * bytes già in memoria funziona sia in Node che nel browser, mentre il fetch() della variante
 * non-compat fallirebbe in Node senza polyfill.
 */

let _world: RAPIER.World | null = null;
let _initialized = false;

/** @internal — GameObject/Component vivi, indipendentemente dal fatto che il loro corpo/collider
 * Rapier sia già stato realizzato. La realizzazione effettiva è deferred (vedi _realizePending). */
const _registeredRigidBodies = new Set<RigidBody>();
const _registeredColliders = new Set<Collider>();

/** @internal — collider Rapier (per handle numerico) → Collider component che lo possiede, usato da Physics.raycast per risalire al GameObject colpito. */
const _colliderOwners = new Map<number, Collider>();

/** @internal — reset completo del modulo (mirror di Engine._resetAll per Scene). Non richiamato
 * da Engine._resetAll(): Engine resta deliberatamente ignaro del modulo Physics (vedi commento su
 * onFixedStep in Engine.ts), quindi chiunque colleghi Physics al proprio loop lo richiama a parte.
 * Due chiamanti: i test che toccano la fisica (isolamento fra un test e l'altro) e
 * `EditorSceneHandle.dispose()` (Fase 5C, packages/editor/src/scene/createEditorScene.ts) — da
 * quando l'editor collega `initPhysics()`/`Physics.step`, senza questa chiamata un
 * remount del Viewport (HMR, React StrictMode) libererebbe un nuovo `RAPIER.World` senza mai
 * liberare quello precedente (stesso rischio già gestito per il registry di GameObject via
 * Engine._resetAll(), vedi il commento in createEditorScene.ts). Esportata da `@engine/core`
 * (index.ts) proprio per questo secondo chiamante, non solo per uso interno al package. */
export function _resetPhysics(): void {
  _world?.free();
  _world = null;
  _initialized = false;
  _registeredRigidBodies.clear();
  _registeredColliders.clear();
  _colliderOwners.clear();
}

export interface InitPhysicsOptions {
  /** Gravità del mondo fisico. Default: (0, -9.81, 0) — gravità terrestre standard, asse Y up come il resto del motore. */
  gravity?: { x: number; y: number; z: number };
}

/**
 * initPhysics — inizializza il modulo WASM di Rapier e crea il `World` condiviso.
 * Operazione asincrona (come `createRenderer` in Fase 2): va chiamata e attesa
 * PRIMA di `engine.start()`. Se `RigidBody`/`Collider` vengono aggiunti a un
 * GameObject prima che questa sia stata completata, la loro realizzazione fisica
 * resta "pending" finché World non esiste — se nel frattempo arriva un tick fisico
 * (`step()` sotto), fallisce rumorosamente invece di ignorare silenziosamente i
 * componenti (vedi commento in `step()`).
 *
 * Idempotente: chiamate successive dopo la prima sono no-op.
 */
export async function initPhysics(options: InitPhysicsOptions = {}): Promise<void> {
  if (_initialized) return;
  await RAPIER.init();
  const gravity = options.gravity ?? { x: 0, y: -9.81, z: 0 };
  _world = new RAPIER.World(gravity);
  _initialized = true;
}

/** Cambia la gravità del mondo fisico a runtime (equivalente di `Physics.gravity` in Unity). */
export function setGravity(gravity: { x: number; y: number; z: number }): void {
  _getWorld().gravity = gravity;
}

/** @internal */
export function _getWorld(): RAPIER.World {
  if (!_world) {
    throw new Error(
      "Physics: World non inizializzato. Chiama e attendi `initPhysics()` prima di usare RigidBody, Collider o Physics.raycast (vedi apps/playground/src/main.ts per l'ordine corretto rispetto a engine.start())."
    );
  }
  return _world;
}

/** @internal — chiamato da RigidBody.awake(). */
export function _registerRigidBody(rb: RigidBody): void {
  _registeredRigidBodies.add(rb);
}
/** @internal — chiamato da RigidBody.onDestroy(). */
export function _unregisterRigidBody(rb: RigidBody): void {
  _registeredRigidBodies.delete(rb);
}
/** @internal — chiamato da Collider.awake(). */
export function _registerCollider(c: Collider): void {
  _registeredColliders.add(c);
}
/** @internal — chiamato da Collider.onDestroy(). */
export function _unregisterCollider(c: Collider): void {
  _registeredColliders.delete(c);
}
/** @internal — chiamato da Collider._realize() dopo aver creato il Collider Rapier. */
export function _registerColliderOwner(handle: number, c: Collider): void {
  _colliderOwners.set(handle, c);
}
/** @internal — chiamato da Collider.onDestroy()/_detachFromRemovedRigidBody(). */
export function _unregisterColliderOwner(handle: number): void {
  _colliderOwners.delete(handle);
}

/**
 * _realizePending — crea il corpo/collider Rapier per ogni RigidBody/Collider
 * registrato che non lo ha ancora (`_body`/`_collider` === null).
 *
 * Decisione architetturale (Unity-style, ordine di addComponent irrilevante):
 * la creazione NON avviene sincronamente dentro `awake()` (a differenza del resto
 * del motore, dove awake() è immediato) ma differita al prossimo tick fisico, in
 * due passate separate — prima tutti i RigidBody, poi tutti i Collider. Questo
 * evita un vincolo d'ordine fragile: se la creazione fosse sincrona, un Collider
 * aggiunto PRIMA del suo RigidBody sullo stesso GameObject non troverebbe nulla a
 * cui agganciarsi (Rapier richiede il RigidBody handle al momento della creazione
 * del Collider per un corpo dinamico/kinematic). Con la realizzazione differita,
 * qualunque ordine di `addComponent(RigidBody)` / `addComponent(BoxCollider)` nello
 * stesso frame funziona: al momento in cui gira questa funzione (inizio del
 * prossimo fixed tick) entrambi i componenti esistono già sul GameObject, quindi
 * `Collider._realize()` può fare `getComponent(RigidBody)` e trovarlo, qualunque
 * fosse l'ordine di inserimento. Costo: un tick di ritardo (tipicamente <16ms a
 * 60Hz) tra addComponent() e l'esistenza fisica effettiva — impercettibile, e
 * comunque il component è già "vivo" (Transform, altri Component) da subito.
 *
 * Limite noto (accettato, non gestito): se un Collider viene realizzato come
 * standalone (nessun RigidBody sul GameObject in quel momento) e un RigidBody
 * viene aggiunto SOLO in un tick successivo, il Collider non si "riaggancia"
 * retroattivamente — Rapier non espone un modo pulito per ri-parentare un
 * collider già creato senza distruggerlo e ricrearlo. Per il caso comune (tutti
 * i componenti del setup fisico aggiunti nello stesso blocco sincrono, come nel
 * playground) questo non si verifica mai; se serve, la soluzione è strutturare
 * il codice così che RigidBody e Collider vengano aggiunti nello stesso frame.
 */
function _realizePending(): void {
  const world = _getWorld();
  for (const rb of _registeredRigidBodies) {
    rb._realize(world);
  }
  for (const c of _registeredColliders) {
    c._realize(world);
  }
}

/**
 * step — avanza la simulazione fisica di un fixed tick. Pensato per essere passato
 * come `onFixedStep` al costruttore di `Engine` (vedi Engine.ts): l'Engine lo invoca
 * una volta per ogni iterazione del suo accumulator, subito dopo aver chiamato
 * `fixedUpdate()` su tutti i Component — quindi eventuali forze/velocità/target
 * kinematic impostati da script utente in `fixedUpdate()` sono già applicati prima
 * che il mondo fisico avanzi.
 *
 * Sequenza per tick (sync bidirezionale fisica↔Transform):
 *   1. Realizza eventuali RigidBody/Collider pending (vedi _realizePending)
 *   2. PUSH: per ogni corpo kinematic, scrive la Transform corrente come target
 *      kinematic Rapier (`setNextKinematicTranslation/Rotation`) — è così che uno
 *      script che sposta `transform.position` di un GameObject kinematic (es. una
 *      piattaforma mobile) fa muovere il corpo fisico coerentemente
 *   3. `world.step()` — Rapier integra la simulazione di un passo fisso
 *   4. PULL: per ogni corpo dynamic, legge la Transform post-step da Rapier e la
 *      scrive nel Transform del GameObject — è così che la fisica fa muovere la
 *      grafica (es. il cubo che cade)
 *
 * I corpi fixed non partecipano né a push né a pull: la loro posizione è fissata
 * alla creazione (comportamento corretto e voluto — un corpo fixed che si muove
 * andrebbe ricreato o gestito con setTranslation esplicito, fuori dallo scope
 * di questa fase).
 */
export function step(fixedDt: number): void {
  if (!_initialized) {
    if (_registeredRigidBodies.size > 0 || _registeredColliders.size > 0) {
      throw new Error(
        "Physics: ci sono RigidBody/Collider registrati ma initPhysics() non è mai stata completata prima che l'Engine iniziasse a ticchettare. Chiama `await initPhysics()` prima di `engine.start()`."
      );
    }
    return;
  }

  const world = _getWorld();
  _realizePending();

  // Tiene il timestep interno di Rapier allineato a Time.fixedDeltaTime, nel caso
  // venga cambiato a runtime via Time.setFixedDeltaTime() (Fase 1) — costo trascurabile.
  world.timestep = fixedDt;

  for (const rb of _registeredRigidBodies) {
    rb._pushKinematic();
  }

  world.step();

  for (const rb of _registeredRigidBodies) {
    rb._pullDynamic();
  }
}

export interface RaycastHit {
  /** Punto di impatto in world space. */
  point: THREE.Vector3;
  /** Normale della superficie colpita, in world space. */
  normal: THREE.Vector3;
  /** Distanza dall'origine del raggio al punto di impatto (in unità mondo, indipendente dalla lunghezza di `direction`). */
  distance: number;
  /** Il Collider component colpito. */
  collider: Collider;
}

/**
 * Physics.raycast — equivalente di `Physics.Raycast` in Unity. `direction` non
 * deve essere necessariamente normalizzato (viene normalizzato internamente, senza
 * mutare il vettore passato dal chiamante) così `distance` nel risultato è sempre
 * in unità mondo reali, non scalata dalla lunghezza di `direction`.
 *
 * Ritorna `null` se il raggio non colpisce nulla entro `maxDistance`.
 */
export function raycast(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance = 100
): RaycastHit | null {
  const world = _getWorld();

  const dirLength = direction.length();
  if (dirLength === 0) return null;
  const normalizedDir = {
    x: direction.x / dirLength,
    y: direction.y / dirLength,
    z: direction.z / dirLength,
  };

  const ray = new RAPIER.Ray(origin, normalizedDir);
  // solid: true — se l'origine è dentro un collider, viene riportato un hit a
  // distanza ~0 invece di attraversarlo senza rilevarlo: comportamento più utile
  // per query di gameplay (es. controllo "sono dentro un trigger fisico?").
  const hit = world.castRayAndGetNormal(ray, maxDistance, true);
  if (!hit) return null;

  const owner = _colliderOwners.get(hit.collider.handle);
  if (!owner) {
    // Non dovrebbe accadere: ogni Collider Rapier creato da questo motore viene
    // registrato in _colliderOwners al momento della realizzazione. Se capita,
    // è un collider Rapier creato fuori dall'API del motore — ignoriamo l'hit
    // invece di esporre un RaycastHit senza un Collider/GameObject valido.
    return null;
  }

  const point = ray.pointAt(hit.timeOfImpact);
  return {
    point: new THREE.Vector3(point.x, point.y, point.z),
    normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    distance: hit.timeOfImpact,
    collider: owner,
  };
}

/** API raggruppata Unity-style (`Physics.init`, `Physics.raycast`, ...), oltre alle singole funzioni esportate sopra. */
export const Physics = {
  init: initPhysics,
  setGravity,
  raycast,
  step,
};
