import type { GameObject } from "./GameObject.js";

/**
 * Scene — registry piatto dei GameObject vivi. Non è (ancora) una vera
 * scene graph con gerarchie multiple: quella la fornisce già three.js
 * via Object3D.parent/children, consultabile tramite Transform. Questo
 * modulo esiste solo per dare al game loop una lista su cui iterare, e
 * per gestire la rimozione differita a fine frame richiesta da Destroy().
 *
 * Deliberatamente un modulo con stato a livello di modulo (non una
 * classe esportata) per tenere l'API `Instantiate`/`Destroy` libera da
 * un parametro "a quale scena" — la Fase 5 (serializzazione scene)
 * potrà introdurre scene multiple senza rompere questa API pubblica.
 */

const _liveObjects = new Set<GameObject>();
const _pendingDestroy = new Set<GameObject>();

/** @internal — chiamato dal costruttore di GameObject. */
export function _registerGameObject(go: GameObject): void {
  _liveObjects.add(go);
}

/** @internal — chiamato da Destroy(); rimozione effettiva rimandata a fine frame. */
export function _unregisterGameObject(go: GameObject): void {
  _pendingDestroy.add(go);
}

/** @internal — snapshot dei GameObject vivi, usato dal game loop per iterare update(). */
export function _getLiveGameObjects(): readonly GameObject[] {
  return Array.from(_liveObjects);
}

/**
 * @internal — eseguito dal game loop alla fine di ogni frame: per ogni
 * GameObject marcato con Destroy(), invoca onDestroy() su tutti i suoi
 * componenti e lo toglie dal registry e dalla scene graph three.js.
 */
export function _flushPendingDestroys(): void {
  if (_pendingDestroy.size === 0) return;
  for (const go of _pendingDestroy) {
    go._destroyAllComponents();
    go._object3D.parent?.remove(go._object3D);
    go._object3D.removeFromParent();
    _liveObjects.delete(go);
  }
  _pendingDestroy.clear();
}

/** @internal — usato dai test per ripartire da uno stato pulito tra un test e l'altro. */
export function _resetScene(): void {
  _liveObjects.clear();
  _pendingDestroy.clear();
}
