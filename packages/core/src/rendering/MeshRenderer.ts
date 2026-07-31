import * as THREE from "three";
import { Component } from "../core/Component.js";

/**
 * MeshShape — forma di una primitiva renderizzabile da `MeshRenderer`, come
 * discriminated union così un `switch` su `kind` può essere esaustivo
 * (stesso pattern di `RigidBodyType`/`_descForType` in RigidBody.ts).
 *
 * `plane` è deliberatamente orizzontale di default (normale verso +Y, come
 * il piano-pavimento più comune negli editor 3D — es. Unity's PrimitiveType.
 * Plane): `PlaneGeometry` di three.js nasce invece verticale (nel piano XY),
 * quindi la correzione di orientamento è applicata internamente al Mesh da
 * `MeshRenderer` (vedi `_rebuild`), non lasciata al Transform del
 * GameObject — così il Transform resta libero per il posizionamento
 * dell'utente senza dover "sapere" di questa correzione.
 */
export type MeshShape =
  | { kind: "box"; size: { x: number; y: number; z: number } }
  | { kind: "sphere"; radius: number }
  | { kind: "plane"; width: number; height: number };

const DEFAULT_SHAPE: MeshShape = { kind: "box", size: { x: 1, y: 1, z: 1 } };
const DEFAULT_COLOR = 0xffffff;
/**
 * Fase 11 — default di metalness/roughness allineati ESATTAMENTE ai default
 * nativi di `THREE.MeshStandardMaterial` (roughness 1.0, metalness 0.0,
 * verificati sul sorgente three.js): prima di questi due campi, `_rebuild()`
 * costruiva già il materiale senza specificarli, quindi il comportamento
 * visivo era già questo — una scena salvata prima di Fase 11 (priva di
 * questi due campi nel JSON, vedi il fallback in SceneSerializer.ts) risulta
 * quindi visivamente identica a prima. Esportate (a differenza di
 * DEFAULT_SHAPE/DEFAULT_COLOR sopra) perché servono anche fuori da questo
 * file: SceneSerializer.ts le riusa come fallback di retrocompatibilità,
 * Inspector.tsx le riusa per il valore iniziale del bottone "Aggiungi
 * componente" — stessa unica-fonte-di-verità già seguita per non duplicare
 * `MeshShape`/`RigidBodyType` fra runtime e formato dati (vedi commento in
 * serialization/types.ts).
 */
export const DEFAULT_METALNESS = 0;
export const DEFAULT_ROUGHNESS = 1;

/**
 * MeshRenderer — Component che possiede una Mesh primitiva (box/sfera/piano)
 * con un colore, aggiunta come figlio diretto dell'Object3D del GameObject.
 *
 * A differenza di RigidBody/Collider (Fase 3), la realizzazione della Mesh è
 * SINCRONA in `awake()`: non c'è alcun motore esterno (Rapier) da attendere,
 * quindi non serve alcuna deferred-realization — il Mesh esiste da subito,
 * consultabile dallo stesso frame (es. dal raycast di selezione
 * dell'editor).
 *
 * Introdotto in Fase 5 per rendere la rappresentazione visiva di un
 * GameObject un DATO (`shape`/`color`) invece che codice imperativo
 * hardcoded in `createEditorScene.ts` — è precisamente ciò che serve
 * perché una scena sopravviva a un ciclo save/load: prima di questo
 * componente non esisteva alcuno stato da cui ricostruire "che aspetto ha"
 * un GameObject.
 */
export class MeshRenderer extends Component {
  private _shape: MeshShape = DEFAULT_SHAPE;
  private _color: number = DEFAULT_COLOR;
  private _metalness: number = DEFAULT_METALNESS;
  private _roughness: number = DEFAULT_ROUGHNESS;
  private _mesh: THREE.Mesh | null = null;

  /** Forma corrente. Assegnarla ricostruisce geometria e mesh immediatamente (dispose della vecchia geometria incluso). */
  get shape(): MeshShape {
    return this._shape;
  }

  set shape(value: MeshShape) {
    this._shape = value;
    this._rebuild();
  }

  /** Colore corrente (0xRRGGBB). Assegnarlo aggiorna il materiale esistente senza ricreare la geometria. */
  get color(): number {
    return this._color;
  }

  set color(value: number) {
    this._color = value;
    if (this._mesh) {
      (this._mesh.material as THREE.MeshStandardMaterial).color.setHex(value);
    }
  }

  /** Metalness corrente (0-1, metallic/roughness workflow di MeshStandardMaterial). Assegnarla aggiorna il materiale esistente senza ricreare la geometria — stesso pattern di `color`. */
  get metalness(): number {
    return this._metalness;
  }

  set metalness(value: number) {
    this._metalness = value;
    if (this._mesh) {
      (this._mesh.material as THREE.MeshStandardMaterial).metalness = value;
    }
  }

  /** Roughness corrente (0-1). Stesso pattern di `metalness` sopra. */
  get roughness(): number {
    return this._roughness;
  }

  set roughness(value: number) {
    this._roughness = value;
    if (this._mesh) {
      (this._mesh.material as THREE.MeshStandardMaterial).roughness = value;
    }
  }

  override awake(): void {
    this._rebuild();
  }

  /**
   * Ricostruisce Mesh/geometria da `_shape`/`_color`. Nota: se `shape` o
   * `color` vengono impostati subito dopo `addComponent(MeshRenderer)` (come
   * fa `createEditorScene.ts`), la Mesh di default (box 1×1×1 bianco) creata
   * da `awake()` viene scartata e ricostruita — un secondo allocamento
   * trascurabile a startup. Evitarlo richiederebbe passare parametri al
   * costruttore, cosa che `addComponent`/`ComponentType` non permettono
   * (istanzia sempre con `new ComponentClass()` senza argomenti, vedi
   * Component.ts) — non introduciamo qui un'eccezione al pattern.
   */
  private _rebuild(): void {
    this._disposeMesh();
    const geometry = geometryForShape(this._shape);
    const material = new THREE.MeshStandardMaterial({
      color: this._color,
      metalness: this._metalness,
      roughness: this._roughness,
    });
    const mesh = new THREE.Mesh(geometry, material);
    if (this._shape.kind === "plane") {
      mesh.rotation.x = -Math.PI / 2;
    }
    this._mesh = mesh;
    this.gameObject._object3D.add(mesh);
  }

  private _disposeMesh(): void {
    if (!this._mesh) return;
    this.gameObject._object3D.remove(this._mesh);
    this._mesh.geometry.dispose();
    (this._mesh.material as THREE.Material).dispose();
    this._mesh = null;
  }

  override onDestroy(): void {
    this._disposeMesh();
  }
}

function geometryForShape(shape: MeshShape): THREE.BufferGeometry {
  switch (shape.kind) {
    case "box":
      return new THREE.BoxGeometry(shape.size.x, shape.size.y, shape.size.z);
    case "sphere":
      return new THREE.SphereGeometry(shape.radius, 32, 16);
    case "plane":
      return new THREE.PlaneGeometry(shape.width, shape.height);
    default: {
      // Controllo di esaustività: se in futuro si aggiunge una forma a
      // MeshShape senza gestirla qui, la build fallisce invece di un bug
      // silenzioso a runtime (stesso pattern di _descForType in RigidBody.ts).
      const exhaustive: never = shape;
      throw new Error(`MeshShape non gestita: ${JSON.stringify(exhaustive)}`);
    }
  }
}
