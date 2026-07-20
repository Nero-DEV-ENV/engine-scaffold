import * as THREE from "three";
import { Transform } from "./Transform.js";
import type { Component, ComponentType, ComponentQueryType } from "./Component.js";
import { _registerGameObject, _unregisterGameObject } from "./Scene.js";

/**
 * GameObject — wrapper Unity-style attorno a un `THREE.Object3D`.
 *
 * Usa composition invece di estendere Object3D: questo tiene lo stato
 * del motore (nome, componenti, flag active) separato dallo stato
 * grafico di three.js, ed evita l'edge case "cosa succede se qualcuno
 * fa new Object3D() a mano e se lo aspetta come GameObject".
 *
 * Ogni GameObject possiede sempre un Transform, creato nel costruttore
 * e mai rimosso — rispecchia il comportamento di Unity dove il
 * Transform non è un componente "opzionale".
 */
export class GameObject {
  name: string;
  readonly transform: Transform;

  /** @internal — l'Object3D three.js sottostante. Usato da rendering/Transform. */
  readonly _object3D: THREE.Object3D;

  private _components: Component[] = [];
  private _active = true;

  /** @internal — marcato true da Destroy(); rimosso dalla Scene a fine frame. */
  _destroyed = false;

  constructor(name = "GameObject") {
    this.name = name;
    this._object3D = new THREE.Object3D();
    this._object3D.name = name;
    this.transform = new Transform(this._object3D);
    // Permette a Transform.parent di risalire dall'Object3D al GameObject/Transform proprietario.
    this._object3D.userData["__transform"] = this.transform;
    this._object3D.userData["__gameObject"] = this;

    _registerGameObject(this);
  }

  get active(): boolean {
    return this._active;
  }

  setActive(value: boolean): void {
    this._active = value;
    this._object3D.visible = value;
  }

  // ---- Componenti --------------------------------------------------

  /**
   * Istanzia e attacca un componente di tipo `ComponentClass` a questo
   * GameObject, chiamandone subito `awake()`. Non sono ammessi due
   * componenti dello stesso tipo esatto sullo stesso GameObject
   * (mirror del comportamento di default in Unity per componenti singleton).
   */
  addComponent<T extends Component>(ComponentClass: ComponentType<T>): T {
    if (this.getComponent(ComponentClass)) {
      throw new Error(
        `GameObject "${this.name}" ha già un componente di tipo ${ComponentClass.name}`
      );
    }
    const component = new ComponentClass();
    component.gameObject = this;
    this._components.push(component);
    component.awake();
    return component;
  }

  /** Restituisce il primo componente del tipo dato (anche una classe base astratta, es. `Collider`), o null se assente. */
  getComponent<T extends Component>(ComponentClass: ComponentQueryType<T>): T | null {
    for (const c of this._components) {
      if (c instanceof ComponentClass) return c;
    }
    return null;
  }

  /** Restituisce tutti i componenti del tipo dato (anche una classe base astratta, es. `Collider`) presenti su questo GameObject. */
  getComponents<T extends Component>(ComponentClass: ComponentQueryType<T>): T[] {
    return this._components.filter((c): c is T => c instanceof ComponentClass);
  }

  /**
   * Rimuove un componente specifico da questo GameObject, chiamandone
   * `onDestroy()`. A differenza di `Destroy(gameObject)`, questo è
   * sincrono: non ha senso rimandarlo a fine frame perché non tocca
   * l'iterazione del loop principale sui GameObject.
   */
  removeComponent(component: Component): void {
    const index = this._components.indexOf(component);
    if (index === -1) return;
    component._destroyed = true;
    component.onDestroy();
    this._components.splice(index, 1);
  }

  /** @internal — usato solo dal game loop per iterare i componenti. */
  _getAllComponents(): readonly Component[] {
    return this._components;
  }

  /** @internal — usato da Destroy() per pulire i componenti prima della rimozione. */
  _destroyAllComponents(): void {
    for (const c of this._components) {
      c._destroyed = true;
      c.onDestroy();
    }
    this._components = [];
  }
}

/**
 * Instantiate — crea un nuovo GameObject, opzionalmente clonando nome e
 * trasformazione iniziale di un altro. Registrato automaticamente nella
 * Scene attiva (vedi Scene.ts) e quindi incluso nel game loop dal
 * prossimo frame.
 */
export function Instantiate(name?: string, position?: THREE.Vector3): GameObject {
  const go = new GameObject(name);
  if (position) {
    go.transform.position = position;
  }
  return go;
}

/**
 * Destroy — marca un GameObject per la distruzione. La rimozione
 * effettiva (chiamata di onDestroy() su tutti i componenti e
 * deregistrazione dalla Scene) avviene a fine frame, non
 * immediatamente: questo evita di mutare la lista dei GameObject
 * mentre il game loop la sta ancora iterando (comportamento identico
 * a Unity).
 */
export function Destroy(gameObject: GameObject): void {
  if (gameObject._destroyed) return;
  gameObject._destroyed = true;
  _unregisterGameObject(gameObject);
}
