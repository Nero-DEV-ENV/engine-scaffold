import * as THREE from "three";

/**
 * Transform — wrapper Unity-style attorno a `THREE.Object3D.position/
 * quaternion/scale`. Ogni GameObject possiede sempre esattamente un
 * Transform (non è un Component rimovibile): è creato dal costruttore
 * di GameObject e mai esposto senza il suo owner.
 *
 * Deliberatamente sottile: non duplica lo stato, delega tutto
 * all'Object3D sottostante così three.js resta l'unica fonte di verità
 * per la matrice di trasformazione (world matrix, parent chain, ecc.).
 */
export class Transform {
  /** @internal */
  readonly _object3D: THREE.Object3D;

  constructor(object3D: THREE.Object3D) {
    this._object3D = object3D;
  }

  // ---- Position ----------------------------------------------------

  get position(): THREE.Vector3 {
    return this._object3D.position;
  }

  set position(value: THREE.Vector3) {
    this._object3D.position.copy(value);
  }

  setPosition(x: number, y: number, z: number): void {
    this._object3D.position.set(x, y, z);
  }

  // ---- Rotation ------------------------------------------------------
  // Esposta sia come euler (comoda, coerente con l'uso comune in Unity)
  // sia come quaternion (fonte di verità interna, evita gimbal-lock
  // accumulation quando si combinano più rotazioni per frame).

  get eulerAngles(): THREE.Euler {
    return this._object3D.rotation;
  }

  set eulerAngles(value: THREE.Euler) {
    this._object3D.rotation.copy(value);
  }

  setEulerAngles(x: number, y: number, z: number): void {
    this._object3D.rotation.set(x, y, z);
  }

  get rotation(): THREE.Quaternion {
    return this._object3D.quaternion;
  }

  set rotation(value: THREE.Quaternion) {
    this._object3D.quaternion.copy(value);
  }

  rotate(x: number, y: number, z: number): void {
    this._object3D.rotateX(x);
    this._object3D.rotateY(y);
    this._object3D.rotateZ(z);
  }

  // ---- Scale ---------------------------------------------------------

  get localScale(): THREE.Vector3 {
    return this._object3D.scale;
  }

  set localScale(value: THREE.Vector3) {
    this._object3D.scale.copy(value);
  }

  setLocalScale(x: number, y: number, z: number): void {
    this._object3D.scale.set(x, y, z);
  }

  // ---- Direzioni derivate (sola lettura, calcolate dal quaternion) ---

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this._object3D.quaternion);
  }

  get right(): THREE.Vector3 {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this._object3D.quaternion);
  }

  get up(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this._object3D.quaternion);
  }

  // ---- Parenting -------------------------------------------------------
  // Delegato a Object3D: aggiungere/rimuovere un child sposta anche la
  // sua sottogerarchia nella scene graph di three.js automaticamente.

  get parent(): Transform | null {
    const parentObject = this._object3D.parent;
    return parentObject ? (parentObject.userData["__transform"] as Transform | undefined) ?? null : null;
  }

  setParent(parent: Transform | null): void {
    if (parent) {
      parent._object3D.add(this._object3D);
    } else {
      this._object3D.parent?.remove(this._object3D);
    }
  }
}
