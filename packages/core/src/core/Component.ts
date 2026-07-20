import type { GameObject } from "./GameObject.js";

/**
 * Component — classe base astratta, analoga a `MonoBehaviour` in Unity.
 * Ogni istanza è legata a esattamente un GameObject (`this.gameObject`)
 * e attraversa un lifecycle gestito interamente dal game loop:
 *
 *   addComponent()  → awake()           (una volta, subito alla creazione)
 *   primo update    → start()           (una volta, prima del primo update)
 *   ogni frame      → update(dt)        (variable timestep)
 *   Destroy()       → onDestroy()       (una volta, a fine frame)
 *
 * Sottoclassi tipicamente sovrascrivono solo i metodi che servono;
 * le implementazioni di default sono no-op.
 */
export abstract class Component {
  /** Il GameObject a cui questo componente è attaccato. Impostato da addComponent(). */
  gameObject!: GameObject;

  /** @internal — usato dal loop per invocare start() una sola volta. */
  _started = false;

  /** @internal — marcato true da Destroy(); il componente viene rimosso a fine frame. */
  _destroyed = false;

  /** Scorciatoia comoda, equivalente a `this.gameObject.transform`. */
  get transform() {
    return this.gameObject.transform;
  }

  /**
   * Chiamato una sola volta, immediatamente quando il componente viene
   * aggiunto via `addComponent`. Utile per inizializzazioni che non
   * dipendono da altri componenti sullo stesso GameObject.
   */
  awake(): void {}

  /**
   * Chiamato una sola volta, prima del primo `update`. A differenza di
   * `awake`, qui è garantito che tutti gli altri componenti aggiunti
   * nello stesso frame siano già stati istanziati (ma non necessariamente
   * "started" — l'ordine tra componenti diversi non è garantito).
   */
  start(): void {}

  /** Chiamato ogni frame variabile, con `dt` = Time.deltaTime del frame corrente. */
  update(_dt: number): void {}

  /**
   * Chiamato a passi fissi di Time.fixedDeltaTime, zero o più volte per
   * frame variabile (accumulator pattern). Non ancora usato da alcun
   * componente built-in: predisposto per la fisica in Fase 3. Lasciato
   * `undefined` di default (invece di un metodo no-op) così Engine può
   * chiamarlo con `component.fixedUpdate?.(dt)` senza iterare inutilmente
   * sui componenti che non lo implementano.
   */
  fixedUpdate?(dt: number): void;

  /** Chiamato quando il GameObject o il componente stesso vengono distrutti. */
  onDestroy(): void {}
}

/** Tipo costruttore usato da `addComponent` per identificare una classe Component da istanziare — deve essere concreto (non astratto), dato che `addComponent` fa `new ComponentClass()`. */
export type ComponentType<T extends Component> = new (...args: never[]) => T;

/**
 * Tipo costruttore usato da `getComponent`/`getComponents` per identificare
 * una classe (o classe base astratta) da cercare via `instanceof`. Più
 * permissivo di `ComponentType`: non serve costruire un'istanza per fare una
 * query, quindi anche una classe base astratta è ammessa — es. `Collider`
 * (Fase 3) è astratta (BoxCollider/SphereCollider sono le sottoclassi
 * concrete) ma `getComponents(Collider)` deve comunque poter trovare
 * qualunque sottotipo concreto presente sul GameObject, esattamente come
 * `GetComponent<Collider>()` in Unity funziona con la classe base.
 */
export type ComponentQueryType<T extends Component> =
  | (new (...args: never[]) => T)
  | (abstract new (...args: never[]) => T);
