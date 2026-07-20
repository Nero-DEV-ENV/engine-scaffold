import RAPIER from "@dimforge/rapier3d-compat";
import { Component } from "../core/Component.js";
import { Collider } from "./Collider.js";
import { _registerRigidBody, _unregisterRigidBody, _getWorld } from "./Physics.js";

/**
 * RigidBodyType — rispecchia le tre categorie di corpo di Rapier. Esposto come
 * enum invece di un semplice `isKinematic: boolean` (come farebbe Unity) perché
 * Rapier distingue esplicitamente kinematic da fixed (in Unity "fixed" è
 * implicito: un GameObject senza Rigidbody con solo un Collider) — mantenere la
 * stessa distinzione a tre vie evita ambiguità nell'API pubblica.
 */
export enum RigidBodyType {
  /** Soggetto a forze, gravità, collisioni — il tipo comune per oggetti che cadono/rimbalzano. */
  Dynamic = "dynamic",
  /** Non soggetto a forze/gravità, ma può spingere corpi dynamic muovendosi via Transform (piattaforme mobili, porte). */
  Kinematic = "kinematic",
  /** Immobile, infinita massa — per geometria statica del livello con cui i corpi dynamic collidono. */
  Fixed = "fixed",
}

function _descForType(type: RigidBodyType): RAPIER.RigidBodyDesc {
  switch (type) {
    case RigidBodyType.Dynamic:
      return RAPIER.RigidBodyDesc.dynamic();
    case RigidBodyType.Kinematic:
      return RAPIER.RigidBodyDesc.kinematicPositionBased();
    case RigidBodyType.Fixed:
      return RAPIER.RigidBodyDesc.fixed();
    default: {
      // Controllo di esaustività: se in futuro si aggiunge un valore a RigidBodyType
      // senza gestirlo qui, questo fa fallire la build invece di un bug silenzioso a runtime.
      const exhaustive: never = type;
      throw new Error(`RigidBodyType non gestito: ${String(exhaustive)}`);
    }
  }
}

/**
 * RigidBody — Component Unity-style (composition, non eredita da Object3D) che
 * aggancia un GameObject al mondo fisico di Rapier.
 *
 * La creazione del corpo Rapier vero e proprio è DEFERITA al primo tick fisico
 * successivo ad `addComponent(RigidBody)` (vedi `_realize`, chiamato da
 * `Physics.step()` tramite il modulo Physics) — non avviene sincronamente in
 * `awake()` come per il resto dei Component del motore. Motivo: un `Collider`
 * sullo stesso GameObject deve poter trovare questo RigidBody già creato quando
 * si aggancia, qualunque sia l'ordine in cui i due componenti sono stati
 * aggiunti — vedi il commento su `_realizePending` in Physics.ts per il
 * ragionamento completo.
 */
export class RigidBody extends Component {
  /** Scala della gravità applicata a questo corpo (1 = gravità piena del World, 0 = nessuna). Solo per corpi dynamic. */
  gravityScale = 1;

  private _type: RigidBodyType = RigidBodyType.Dynamic;

  /** @internal — il corpo Rapier sottostante, null finché non realizzato (vedi _realize). */
  _body: RAPIER.RigidBody | null = null;

  /** Tipo di corpo. Leggibile/scrivibile anche dopo la realizzazione: se il corpo
   * esiste già, il cambio si applica immediatamente al corpo Rapier sottostante
   * (equivalente a un `isKinematic` toggle a runtime in Unity). */
  get type(): RigidBodyType {
    return this._type;
  }

  set type(value: RigidBodyType) {
    this._type = value;
    this._body?.setBodyType(_toRapierBodyType(value), true);
  }

  override awake(): void {
    _registerRigidBody(this);
  }

  /** @internal — chiamato da Physics._realizePending(), no-op se già realizzato. */
  _realize(world: RAPIER.World): void {
    if (this._body) return;
    const desc = _descForType(this._type)
      .setTranslation(this.transform.position.x, this.transform.position.y, this.transform.position.z)
      .setRotation(this.transform.rotation)
      .setGravityScale(this.gravityScale);
    this._body = world.createRigidBody(desc);
  }

  /** @internal — chiamato da Physics.step() prima di world.step(), solo per corpi kinematic: scrive la Transform corrente come target Rapier per il prossimo step. */
  _pushKinematic(): void {
    if (!this._body || this._type !== RigidBodyType.Kinematic) return;
    this._body.setNextKinematicTranslation(this.transform.position);
    this._body.setNextKinematicRotation(this.transform.rotation);
  }

  /** @internal — chiamato da Physics.step() dopo world.step(), solo per corpi dynamic: legge la Transform post-step da Rapier e la scrive nel Transform del GameObject. */
  _pullDynamic(): void {
    if (!this._body || this._type !== RigidBodyType.Dynamic) return;
    const t = this._body.translation();
    const r = this._body.rotation();
    this.transform.position.set(t.x, t.y, t.z);
    this.transform.rotation.set(r.x, r.y, r.z, r.w);
  }

  // ---- API di comodo Unity-style, delegano al corpo Rapier sottostante -------

  /** Applica una forza continua (accumulata fino al prossimo step). No-op se il corpo non è ancora stato realizzato. */
  addForce(force: { x: number; y: number; z: number }, wakeUp = true): void {
    this._body?.addForce(force, wakeUp);
  }

  /** Applica un impulso istantaneo (variazione di quantità di moto). No-op se il corpo non è ancora stato realizzato. */
  applyImpulse(impulse: { x: number; y: number; z: number }, wakeUp = true): void {
    this._body?.applyImpulse(impulse, wakeUp);
  }

  /** Imposta direttamente la velocità lineare. No-op se il corpo non è ancora stato realizzato. */
  setLinearVelocity(velocity: { x: number; y: number; z: number }, wakeUp = true): void {
    this._body?.setLinvel(velocity, wakeUp);
  }

  /** Velocità lineare corrente, o (0,0,0) se il corpo non è ancora stato realizzato. */
  getLinearVelocity(): { x: number; y: number; z: number } {
    return this._body?.linvel() ?? { x: 0, y: 0, z: 0 };
  }

  override onDestroy(): void {
    _unregisterRigidBody(this);
    if (this._body) {
      // world.removeRigidBody() rimuove in cascata (lato Rapier) anche tutti i
      // Collider agganciati a questo corpo. Se un Collider component è ancora
      // vivo sullo stesso GameObject, l'ordine tra i due onDestroy() NON è
      // garantito (GameObject._destroyAllComponents itera l'array dei
      // component nell'ordine di inserimento) — se RigidBody viene distrutto
      // per primo, dobbiamo avvisare il/i Collider PRIMA della cascade così il
      // loro onDestroy() (quando gira, prima o dopo) trovi il riferimento già
      // invalidato e non tenti una removeCollider() su un handle già eliminato
      // da Rapier (che altrimenti fallirebbe/andrebbe in stato indefinito).
      for (const collider of this.gameObject.getComponents(Collider)) {
        collider._detachFromRemovedRigidBody();
      }
      _getWorld().removeRigidBody(this._body);
      this._body = null;
    }
  }
}

function _toRapierBodyType(type: RigidBodyType): RAPIER.RigidBodyType {
  switch (type) {
    case RigidBodyType.Dynamic:
      return RAPIER.RigidBodyType.Dynamic;
    case RigidBodyType.Kinematic:
      return RAPIER.RigidBodyType.KinematicPositionBased;
    case RigidBodyType.Fixed:
      return RAPIER.RigidBodyType.Fixed;
    default: {
      const exhaustive: never = type;
      throw new Error(`RigidBodyType non gestito: ${String(exhaustive)}`);
    }
  }
}
