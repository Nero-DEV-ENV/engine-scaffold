import RAPIER from "@dimforge/rapier3d-compat";
import { Component } from "../core/Component.js";
import { RigidBody } from "./RigidBody.js";
import {
  _registerCollider,
  _unregisterCollider,
  _registerColliderOwner,
  _unregisterColliderOwner,
  _getWorld,
} from "./Physics.js";

/**
 * Collider — Component Unity-style astratto, base per le forme concrete
 * (BoxCollider, SphereCollider, ...). Come RigidBody, la creazione del
 * Collider Rapier vero e proprio è deferita al primo tick fisico
 * successivo alla `addComponent` (vedi `_realize`).
 *
 * Un Collider può esistere SENZA un RigidBody sullo stesso GameObject:
 * in quel caso diventa un collider Rapier "standalone" (implicitamente
 * statico), utile per geometria di livello che non deve muoversi — è
 * il caso del piano nel deliverable di questa fase. Se invece un
 * RigidBody è presente, il Collider vi si aggancia (Rapier lo tratta
 * come "parent"), e la sua posizione segue quella del corpo.
 *
 * Limite noto e voluto: un Collider standalone cattura la posizione dal
 * Transform una sola volta, alla realizzazione — non viene risincronizzato
 * ad ogni tick. Per un collider che deve muoversi senza essere soggetto a
 * forze fisiche, la scelta corretta è un RigidBody di tipo Kinematic (che
 * IS sincronizzato ogni tick, vedi RigidBody._pushKinematic), non un
 * Collider standalone la cui Transform viene letta di continuo — esattamente
 * come in Unity, dove muovere il Transform di un Collider senza Rigidbody
 * è sconsigliato/costoso e la soluzione raccomandata è un Rigidbody kinematic.
 */
export abstract class Collider extends Component {
  /** Attrito Coulomb (0 = ghiaccio, valori tipici 0.3–1). */
  friction = 0.5;
  /** Elasticità del rimbalzo (0 = nessun rimbalzo, 1 = rimbalzo perfetto senza perdita di energia). */
  restitution = 0;
  /** Se true, il collider rileva le sovrapposizioni ma non genera risposta fisica (sensore/trigger). */
  isTrigger = false;

  /** @internal — il collider Rapier sottostante, null finché non realizzato. */
  _collider: RAPIER.Collider | null = null;

  /** @internal — sottoclassi concrete costruiscono la ColliderDesc per la loro forma (senza impostare posizione/friction/restitution/sensor, gestiti qui). */
  protected abstract _createDesc(): RAPIER.ColliderDesc;

  override awake(): void {
    _registerCollider(this);
  }

  /** @internal — chiamato da Physics._realizePending() DOPO che tutti i RigidBody pending sono già stati realizzati (vedi Physics.ts), no-op se già realizzato. */
  _realize(world: RAPIER.World): void {
    if (this._collider) return;

    const desc = this._createDesc()
      .setFriction(this.friction)
      .setRestitution(this.restitution)
      .setSensor(this.isTrigger);

    const rb = this.gameObject.getComponent(RigidBody);
    if (rb) {
      if (!rb._body) {
        // Non dovrebbe accadere: Physics._realizePending() realizza sempre
        // prima tutti i RigidBody registrati, poi tutti i Collider.
        throw new Error(
          `Collider: il RigidBody sul GameObject "${this.gameObject.name}" non risulta ancora realizzato — bug interno nell'ordine di realizzazione del modulo Physics.`
        );
      }
      this._collider = world.createCollider(desc, rb._body);
    } else {
      desc.setTranslation(this.transform.position.x, this.transform.position.y, this.transform.position.z);
      desc.setRotation(this.transform.rotation);
      this._collider = world.createCollider(desc);
    }

    _registerColliderOwner(this._collider.handle, this);
  }

  /** @internal — chiamato dal RigidBody agganciato quando viene rimosso: world.removeRigidBody() ha già eliminato in cascata (lato Rapier) questo Collider, quindi qui ci limitiamo a invalidare il riferimento locale senza tentare una removeCollider() su un handle già eliminato. */
  _detachFromRemovedRigidBody(): void {
    if (this._collider) {
      _unregisterColliderOwner(this._collider.handle);
      this._collider = null;
    }
  }

  override onDestroy(): void {
    _unregisterCollider(this);
    if (this._collider) {
      _unregisterColliderOwner(this._collider.handle);
      _getWorld().removeCollider(this._collider, true);
      this._collider = null;
    }
  }
}

/**
 * BoxCollider — collider a forma di parallelepipedo. `size` è l'estensione
 * TOTALE (Unity-style: `BoxCollider.size`), non il mezzo-lato richiesto
 * dall'API nativa di Rapier (`cuboid(hx, hy, hz)`) — la conversione è
 * interna, così l'API pubblica resta coerente con l'idioma Unity invece
 * di esporre la convenzione "half-extent" di Rapier.
 */
export class BoxCollider extends Collider {
  size = { x: 1, y: 1, z: 1 };

  protected override _createDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.cuboid(this.size.x / 2, this.size.y / 2, this.size.z / 2);
  }
}

/** SphereCollider — collider a forma di sfera. */
export class SphereCollider extends Collider {
  radius = 0.5;

  protected override _createDesc(): RAPIER.ColliderDesc {
    return RAPIER.ColliderDesc.ball(this.radius);
  }
}
