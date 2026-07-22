import * as THREE from "three";
import { Component } from "../core/Component.js";

/**
 * LightKind — discriminante per il tipo di luce, stesso pattern di `MeshShape`
 * (rendering/MeshRenderer.ts): un `switch` esaustivo su `kind` può così fallire
 * la build se in futuro si aggiunge un tipo senza gestirlo ovunque serve.
 *
 * Mirror deliberato di Unity, dove `Light` è UN SOLO componente con un campo
 * `type` (Directional/Point/Spot/Area) le cui proprietà visibili cambiano in
 * base al tipo scelto — non componenti separati per tipo (a differenza di
 * `Collider`/`BoxCollider`/`SphereCollider`, dove Unity stesso usa classi
 * diverse). Per questo motore, al momento, solo "ambient" e "directional"
 * sono supportati (i soli due usati da `createBasicLighting`); Point/Spot/Area
 * si aggiungerebbero come ulteriori membri di questa union quando servirà,
 * senza cambiare la forma del componente.
 *
 * "ambient" non ha proprietà proprie: `THREE.AmbientLight` non ha posizione
 * né direzione, illumina uniformemente l'intera scena. "directional" porta
 * invece l'offset locale (relativo all'Object3D del GameObject che possiede
 * questo Component) della sorgente: `THREE.DirectionalLight` punta sempre
 * verso l'origine del proprio target di default, quindi la sua posizione
 * conta solo per calcolare la direzione del fascio — stesso comportamento
 * già presente in `createBasicLighting()` prima di questo Component.
 */
export type LightKind =
  | { kind: "ambient" }
  | { kind: "directional"; position: { x: number; y: number; z: number } };

const DEFAULT_KIND: LightKind = { kind: "ambient" };
const DEFAULT_COLOR = 0xffffff;
const DEFAULT_INTENSITY = 1;

/**
 * Light — Component che possiede una `THREE.Light` (Ambient o Directional)
 * aggiunta come figlio diretto dell'Object3D del GameObject.
 *
 * Stesso pattern di `MeshRenderer`: realizzazione SINCRONA in `awake()` (non
 * c'è alcun motore esterno da attendere, a differenza di RigidBody/Collider),
 * `onDestroy()` rimuove l'istanza dalla scena. A differenza di `MeshRenderer`,
 * non c'è un `dispose()` esplicito da chiamare sulla luce rimossa: né
 * `THREE.AmbientLight` né `THREE.DirectionalLight` possiedono risorse GPU
 * (geometria/materiale) da rilasciare — la semplice rimozione dall'Object3D
 * basta perché il garbage collector faccia il resto.
 *
 * Introdotto in Fase 5B.4 per rendere una luce un DATO (`kind`/`color`/
 * `intensity`) invece di codice imperativo hardcoded in
 * `createBasicLighting()`/`createEditorScene.ts` — esattamente lo stesso
 * motivo per cui `MeshRenderer` esiste dalla Fase 5A: senza questo
 * Component non c'era alcuno stato da cui ricostruire una luce dopo un
 * ciclo save/load.
 */
export class Light extends Component {
  private _kind: LightKind = DEFAULT_KIND;
  private _color: number = DEFAULT_COLOR;
  private _intensity: number = DEFAULT_INTENSITY;
  private _light: THREE.Light | null = null;

  /** Tipo di luce corrente. Assegnarlo ricostruisce l'istanza THREE.Light immediatamente (la precedente viene rimossa dalla scena, nessun dispose necessario — vedi commento di classe). */
  get kind(): LightKind {
    return this._kind;
  }

  set kind(value: LightKind) {
    this._kind = value;
    this._rebuild();
  }

  /** Colore corrente (0xRRGGBB). Assegnarlo aggiorna l'istanza esistente senza ricostruirla. */
  get color(): number {
    return this._color;
  }

  set color(value: number) {
    this._color = value;
    if (this._light) this._light.color.setHex(value);
  }

  /** Intensità corrente. Assegnarla aggiorna l'istanza esistente senza ricostruirla. */
  get intensity(): number {
    return this._intensity;
  }

  set intensity(value: number) {
    this._intensity = value;
    if (this._light) this._light.intensity = value;
  }

  override awake(): void {
    this._rebuild();
  }

  /**
   * Ricostruisce la THREE.Light da `_kind`/`_color`/`_intensity`. Nota: se
   * `kind`/`color`/`intensity` vengono impostati subito dopo
   * `addComponent(Light)` (come fa `createBasicLighting()`), l'istanza di
   * default (ambient bianca, intensità 1) creata da `awake()` viene scartata
   * e ricostruita — stesso trade-off trascurabile già accettato e documentato
   * in `MeshRenderer._rebuild()`.
   */
  private _rebuild(): void {
    this._removeLight();
    this._light = lightForKind(this._kind, this._color, this._intensity);
    this.gameObject._object3D.add(this._light);
  }

  private _removeLight(): void {
    if (!this._light) return;
    this.gameObject._object3D.remove(this._light);
    this._light = null;
  }

  override onDestroy(): void {
    this._removeLight();
  }
}

function lightForKind(kind: LightKind, color: number, intensity: number): THREE.Light {
  switch (kind.kind) {
    case "ambient":
      return new THREE.AmbientLight(color, intensity);
    case "directional": {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(kind.position.x, kind.position.y, kind.position.z);
      return light;
    }
    default: {
      // Controllo di esaustività: se in futuro si aggiunge un membro a
      // LightKind senza gestirlo qui, la build fallisce invece di un bug
      // silenzioso a runtime (stesso pattern di geometryForShape in MeshRenderer.ts).
      const exhaustive: never = kind;
      throw new Error(`LightKind non gestito: ${JSON.stringify(exhaustive)}`);
    }
  }
}
