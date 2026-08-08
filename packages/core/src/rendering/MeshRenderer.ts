import * as THREE from "three";
import { Component } from "../core/Component.js";
import { requestTexture, releaseTexture, getMissingTexture, subscribeTextureUpdates } from "./AssetLoader.js";

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

/**
 * shapesEqual — Fase 11B.1 (fix da smoke-test): confronto strutturale fra
 * due `MeshShape`, usato dal setter `shape` sotto per evitare un
 * `_rebuild()` (dispose+ricrea geometria/materiale) quando la forma
 * assegnata è IDENTICA a quella corrente. Prima di questo fix, `shape`
 * veniva riassegnato incondizionatamente ad OGNI commit di
 * `updateComponentData`/`applyComponentData` (SceneSerializer.ts) —
 * anche quando a cambiare era un campo completamente diverso (es.
 * trascinare lo slider Opacity) — quindi ogni singolo tick rigenerava
 * l'intero materiale, ririchiedendo la mappa Albedo da zero (flash
 * ripetuto del placeholder "texture mancante" per tutta la durata del
 * drag, riscontrato in smoke-test, non solo per albedoMap: il rebuild
 * stesso è la causa, indipendentemente da quale campo abbia innescato il
 * commit). Prima di questo fix passava inosservato perché un rebuild
 * senza texture agganciata non produce alcun artefatto visivo.
 */
function shapesEqual(a: MeshShape, b: MeshShape): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "box": {
      const other = b as Extract<MeshShape, { kind: "box" }>;
      return a.size.x === other.size.x && a.size.y === other.size.y && a.size.z === other.size.z;
    }
    case "sphere": {
      const other = b as Extract<MeshShape, { kind: "sphere" }>;
      return a.radius === other.radius;
    }
    case "plane": {
      const other = b as Extract<MeshShape, { kind: "plane" }>;
      return a.width === other.width && a.height === other.height;
    }
  }
}
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
 * Fase 11B.1 (addendum) — default di `transparent`, allineato al default
 * nativo di `THREE.MeshStandardMaterial` (`transparent: false`): un
 * materiale creato prima di questo campo si comportava già così, quindi
 * l'assenza del campo (scena salvata prima di questo addendum) resta
 * visivamente identica.
 */
export const DEFAULT_TRANSPARENT = false;
/**
 * Fase 11B.1 (addendum 2) — default di `opacity`, allineato al default
 * nativo di `THREE.MeshStandardMaterial` (`opacity: 1`, completamente
 * opaco). Concettualmente distinto da `transparent` (che abilita il
 * blending) e dal canale alpha della texture Albedo stessa: `opacity` è
 * un moltiplicatore globale aggiuntivo, utile anche senza una texture con
 * trasparenza propria — ma ha effetto visivo solo se `transparent` è
 * `true` (altrimenti three.js ignora il canale alpha nel compositing,
 * stesso motivo per cui `transparent` esiste come flag separato).
 */
export const DEFAULT_OPACITY = 1;
/**
 * Fase 11B.2 — default di `emissive` (colore scalare, indipendente dalla
 * mappa `emissiveMap`), allineato al default nativo di
 * `THREE.MeshStandardMaterial` (`emissive: 0x000000`, nero = nessuna
 * emissione): stessa retrocompatibilità già seguita per gli altri default
 * di questo file, una scena salvata prima di questo campo resta
 * visivamente identica.
 */
export const DEFAULT_EMISSIVE = 0x000000;

/**
 * TextureMapSlot — Fase 11B.2: stato e logica di caricamento CONDIVISI da
 * ciascuna delle 6 mappe texture di MeshRenderer (Albedo/Normal/Roughness/
 * Metalness/AO/Emissive — vedi i campi `_albedoSlot`/`_normalSlot`/ecc.
 * sotto). Estratta qui perché ripetere questa logica per copia-incolla 5
 * volte in più (una per mappa) avrebbe ripetuto anche la stessa classe di
 * bug corretta in 11B.1 per Albedo (guardia sul setter contro riassegnazioni
 * ridondanti, token anti-race sulla risoluzione asincrona, retain/release
 * refcounted) altre 5 volte — un solo punto di verità per questa logica è
 * più sicuro che mantenerne 6 copie sincronizzate a mano. Le proprietà
 * PUBBLICHE di MeshRenderer (get/set `albedoMap`, `normalMap`, ecc.)
 * restano individuali, una per campo (stesso stile esplicito già seguito
 * dal resto del file) — ognuna delega a una propria istanza privata di
 * questa classe, non è un cambiamento dell'API osservabile.
 *
 * `getMesh` è un accessor (non un riferimento diretto alla Mesh) perché la
 * Mesh corrente può cambiare fra l'inizio di un caricamento asincrono e la
 * sua risoluzione (`_rebuild()` per un cambio di `shape` nel frattempo):
 * la callback di risoluzione deve rileggere la Mesh/materiale CORRENTI al
 * momento in cui la Promise si risolve, mai quelli catturati all'avvio
 * della richiesta — stesso principio già seguito dall'implementazione
 * originale di Albedo in 11B.1 (`this._mesh?.material`, mai una variabile
 * locale catturata).
 */
class TextureMapSlot {
  private _path: string | undefined = undefined;
  private _retainedPath: string | undefined = undefined;
  private _token = 0;
  private _unsubscribe: (() => void) | undefined = undefined;

  constructor(
    private readonly materialProperty: "map" | "normalMap" | "roughnessMap" | "metalnessMap" | "aoMap" | "emissiveMap",
    private readonly getMesh: () => THREE.Mesh | null
  ) {}

  get path(): string | undefined {
    return this._path;
  }

  /**
   * Aggiorna il percorso desiderato. Restituisce `true` se è CAMBIATO
   * (il chiamante deve poi invocare `apply()`), `false` se era già questo
   * valore (guardia — stesso motivo del fix `albedoMap` in 11B.1: senza,
   * ogni commit di QUALUNQUE campo del componente ririchiederebbe la
   * texture da zero, causando il flash del placeholder già corretto).
   */
  setPath(value: string | undefined): boolean {
    if (value === this._path) return false;
    this._path = value;
    return true;
  }

  /**
   * Applica lo stato corrente (`this._path`) al materiale della Mesh
   * corrente (`getMesh()`), gestendo retain/release refcounted, il token
   * anti-race e la sottoscrizione a `invalidateTexture`. Va chiamata dopo
   * `setPath()` (se ha restituito `true`) E dopo ogni `_rebuild()` (nuovo
   * materiale, stesso `_path` — per non perdere l'assegnazione dopo un
   * cambio di `shape`, stesso principio già seguito da `_rebuild()` per
   * Albedo in 11B.1).
   */
  apply(): void {
    this._releaseRetained();
    const token = ++this._token;
    const material = this.getMesh()?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) return;

    if (this._path === undefined) {
      this._setMaterialTexture(material, null);
      return;
    }

    const path = this._path;
    const pending = requestTexture(path);
    if (!pending) {
      this._setMaterialTexture(material, getMissingTexture());
      return;
    }
    this._retainedPath = path;
    this._unsubscribe = subscribeTextureUpdates(path, (texture) => {
      // Fase 11B.2 — invalidazione: il token NON viene incrementato qui
      // (non è una nuova richiesta, la stessa assegnazione resta valida),
      // va solo scartata se un'assegnazione più recente ha nel frattempo
      // soppiantato questa (in quel caso `_releaseRetained()` sopra ha già
      // annullato questa sottoscrizione, quindi la callback non dovrebbe
      // più poter scattare — controllo comunque per difesa).
      if (token !== this._token) return;
      const currentMaterial = this.getMesh()?.material as THREE.MeshStandardMaterial | undefined;
      if (currentMaterial) this._setMaterialTexture(currentMaterial, texture);
    });
    this._setMaterialTexture(material, getMissingTexture());
    pending
      .then((texture) => {
        if (token !== this._token) return;
        const currentMaterial = this.getMesh()?.material as THREE.MeshStandardMaterial | undefined;
        if (currentMaterial) this._setMaterialTexture(currentMaterial, texture);
      })
      .catch(() => {
        if (token !== this._token) return;
        const currentMaterial = this.getMesh()?.material as THREE.MeshStandardMaterial | undefined;
        if (currentMaterial) this._setMaterialTexture(currentMaterial, getMissingTexture());
      });
  }

  /** Rilascia il riferimento refcounted e la sottoscrizione correnti, se presenti. Va chiamata da `_disposeMesh()`. */
  release(): void {
    this._releaseRetained();
  }

  private _releaseRetained(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = undefined;
    }
    if (this._retainedPath !== undefined) {
      releaseTexture(this._retainedPath);
      this._retainedPath = undefined;
    }
  }

  private _setMaterialTexture(material: THREE.MeshStandardMaterial, texture: THREE.Texture | null): void {
    material[this.materialProperty] = texture;
    material.needsUpdate = true;
  }
}

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
  /** Fase 11B.1 (addendum) — se il materiale rispetta il canale alpha di `albedoMap`/di `color`. Vedi getter/setter `transparent` sotto. */
  private _transparent: boolean = DEFAULT_TRANSPARENT;
  /** Fase 11B.1 (addendum 2) — moltiplicatore di opacità globale (0-1). Vedi getter/setter `opacity` sotto. */
  private _opacity: number = DEFAULT_OPACITY;
  /** Fase 11B.2 — colore emissivo scalare (0xRRGGBB), indipendente da `emissiveMap` sotto. Vedi getter/setter `emissive` sotto. */
  private _emissive: number = DEFAULT_EMISSIVE;
  private _mesh: THREE.Mesh | null = null;

  // Fase 11B.1/11B.2 — le 6 mappe texture di MeshStandardMaterial condividono
  // tutte la stessa logica di caricamento asincrono/retain/release/invalidazione,
  // vedi `TextureMapSlot` sopra. `getMesh: () => this._mesh` è un accessor
  // (non `this._mesh` catturato per valore) per lo stesso motivo spiegato lì.
  private _albedoSlot = new TextureMapSlot("map", () => this._mesh);
  private _normalSlot = new TextureMapSlot("normalMap", () => this._mesh);
  private _roughnessSlot = new TextureMapSlot("roughnessMap", () => this._mesh);
  private _metalnessSlot = new TextureMapSlot("metalnessMap", () => this._mesh);
  private _aoSlot = new TextureMapSlot("aoMap", () => this._mesh);
  private _emissiveSlot = new TextureMapSlot("emissiveMap", () => this._mesh);

  /** Tutti gli slot texture di questa istanza, per iterarli in `_rebuild()`/`_disposeMesh()` senza ripetere i 6 nomi ad ogni punto. */
  private _allTextureSlots(): readonly TextureMapSlot[] {
    return [this._albedoSlot, this._normalSlot, this._roughnessSlot, this._metalnessSlot, this._aoSlot, this._emissiveSlot];
  }

  /** Forma corrente. Assegnarla ricostruisce geometria e mesh immediatamente (dispose della vecchia geometria incluso). */
  get shape(): MeshShape {
    return this._shape;
  }

  set shape(value: MeshShape) {
    // Fase 11B.1 (fix da smoke-test) — vedi JSDoc di `shapesEqual` sopra:
    // niente rebuild (dispose+ricrea mesh/materiale) se la forma è
    // strutturalmente identica alla corrente.
    if (shapesEqual(value, this._shape)) return;
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

  /**
   * Fase 11B.1 (addendum, richiesto dall'utente durante lo smoke-test) —
   * se `true`, il materiale rispetta il canale alpha di `albedoMap` (e di
   * `color`, che ha comunque un proprio canale alpha in three.js anche
   * senza texture) invece di ignorarlo come fa di default
   * `MeshStandardMaterial` (`transparent: false`, alpha sempre 1). Stesso
   * pattern sincrono di color/metalness/roughness: assegnarlo aggiorna il
   * materiale esistente senza ricreare la geometria.
   */
  get transparent(): boolean {
    return this._transparent;
  }

  set transparent(value: boolean) {
    this._transparent = value;
    if (this._mesh) {
      const material = this._mesh.material as THREE.MeshStandardMaterial;
      material.transparent = value;
      material.needsUpdate = true;
    }
  }

  /**
   * Fase 11B.1 (addendum 2) — opacità globale (0-1), stesso pattern
   * sincrono di color/metalness/roughness. Ha effetto visivo solo con
   * `transparent === true` (vedi commento su `DEFAULT_OPACITY`) — nessun
   * controllo incrociato qui: assegnabile comunque indipendentemente,
   * stessa scelta già fatta per color/metalness/roughness fra loro (ogni
   * campo è un dato indipendente, la UI in Inspector.tsx può comunque
   * suggerire la relazione senza che il motore la imponga).
   */
  get opacity(): number {
    return this._opacity;
  }

  set opacity(value: number) {
    this._opacity = value;
    if (this._mesh) {
      const material = this._mesh.material as THREE.MeshStandardMaterial;
      material.opacity = value;
      material.needsUpdate = true;
    }
  }

  /**
   * Fase 11B.2 — colore emissivo scalare (0xRRGGBB), indipendente dalla
   * mappa `emissiveMap` sotto (le due si MOLTIPLICANO fra loro, stesso
   * comportamento nativo `MeshStandardMaterial` già visto per
   * color/albedoMap — nessuna logica da reinventare qui). Stesso pattern
   * sincrono di `color`: assegnarlo aggiorna il materiale esistente senza
   * ricreare la geometria.
   */
  get emissive(): number {
    return this._emissive;
  }

  set emissive(value: number) {
    this._emissive = value;
    if (this._mesh) {
      (this._mesh.material as THREE.MeshStandardMaterial).emissive.setHex(value);
    }
  }

  /**
   * Mappa Albedo corrente (Fase 11B.1): percorso RELATIVO alla project
   * folder (es. "Textures/wood_albedo.png"), o `undefined` = nessuna
   * texture assegnata (materiale a colore piatto, comportamento identico a
   * prima di questa fase — stessa retrocompatibilità già seguita per
   * metalness/roughness in Fase 11). A differenza di color/metalness/
   * roughness (sincroni), il caricamento è ASINCRONO — vedi `TextureMapSlot`
   * sopra per la gestione di race/dispose/fallback/invalidazione, condivisa
   * dalle 6 mappe di questa classe.
   */
  get albedoMap(): string | undefined {
    return this._albedoSlot.path;
  }

  set albedoMap(value: string | undefined) {
    if (this._albedoSlot.setPath(value)) this._albedoSlot.apply();
  }

  /**
   * Mappa Normal corrente (Fase 11B.2): percorso RELATIVO alla project
   * folder, o `undefined` = nessuna (materiale senza rilievo superficiale
   * aggiuntivo, comportamento identico a prima di questo campo). Stesso
   * pattern asincrono di `albedoMap` sopra.
   */
  get normalMap(): string | undefined {
    return this._normalSlot.path;
  }

  set normalMap(value: string | undefined) {
    if (this._normalSlot.setPath(value)) this._normalSlot.apply();
  }

  /**
   * Mappa Roughness corrente (Fase 11B.2): percorso RELATIVO alla project
   * folder, o `undefined` = nessuna. COESISTE con lo slider numerico
   * `roughness` sopra (Fase 11), che resta il moltiplicatore scalare — la
   * mappa modula quel valore per-pixel, comportamento nativo di three.js
   * (`roughnessMap` letto dal canale verde, moltiplicato per `roughness`),
   * nessuna logica aggiuntiva da questo componente. Stesso pattern
   * asincrono di `albedoMap` sopra.
   */
  get roughnessMap(): string | undefined {
    return this._roughnessSlot.path;
  }

  set roughnessMap(value: string | undefined) {
    if (this._roughnessSlot.setPath(value)) this._roughnessSlot.apply();
  }

  /**
   * Mappa Metalness corrente (Fase 11B.2): percorso RELATIVO alla project
   * folder, o `undefined` = nessuna. Stessa relazione di `roughnessMap`
   * sopra con lo slider scalare `metalness` (Fase 11) — modula quel valore
   * per-pixel (canale blu), non lo sostituisce. Stesso pattern asincrono di
   * `albedoMap` sopra.
   */
  get metalnessMap(): string | undefined {
    return this._metalnessSlot.path;
  }

  set metalnessMap(value: string | undefined) {
    if (this._metalnessSlot.setPath(value)) this._metalnessSlot.apply();
  }

  /**
   * Mappa Ambient Occlusion corrente (Fase 11B.2): percorso RELATIVO alla
   * project folder, o `undefined` = nessuna. Richiede il secondo canale UV
   * (`uv2`) sulla geometria — vedi `geometryForShape` sotto, già garantito
   * su tutte le primitive indipendentemente da questo campo. Stesso pattern
   * asincrono di `albedoMap` sopra.
   */
  get aoMap(): string | undefined {
    return this._aoSlot.path;
  }

  set aoMap(value: string | undefined) {
    if (this._aoSlot.setPath(value)) this._aoSlot.apply();
  }

  /**
   * Mappa Emissive corrente (Fase 11B.2): percorso RELATIVO alla project
   * folder, o `undefined` = nessuna. COESISTE con `emissive` sopra (colore
   * scalare) — le due si moltiplicano fra loro, comportamento nativo three.js,
   * nessun reset automatico dell'una quando si assegna l'altra (a differenza
   * di `albedoMap`+`color`: qui un `emissive` nero di default — vedi
   * `DEFAULT_EMISSIVE` — non "tinge" via moltiplicazione in modo sorprendente,
   * semplicemente non emette nulla finché l'utente non lo alza di proposito).
   * Stesso pattern asincrono di `albedoMap` sopra.
   */
  get emissiveMap(): string | undefined {
    return this._emissiveSlot.path;
  }

  set emissiveMap(value: string | undefined) {
    if (this._emissiveSlot.setPath(value)) this._emissiveSlot.apply();
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
      transparent: this._transparent,
      opacity: this._opacity,
      emissive: this._emissive,
    });
    const mesh = new THREE.Mesh(geometry, material);
    if (this._shape.kind === "plane") {
      mesh.rotation.x = -Math.PI / 2;
    }
    this._mesh = mesh;
    this.gameObject._object3D.add(mesh);
    // Fase 11B.1/11B.2 — il materiale appena creato sopra non ha ancora
    // alcuna mappa: per ognuna delle 6 già assegnata prima di questo
    // rebuild (es. cambio di `shape`), va ri-richiesta/riapplicata al
    // nuovo materiale. `_disposeMesh()` sopra (chiamata da questo stesso
    // `_rebuild()`) ha già rilasciato i riferimenti precedenti — questa
    // chiamata ne acquisisce di freschi (cache hit istantaneo se ancora in
    // cache, nessun ricaricamento di rete duplicato).
    for (const slot of this._allTextureSlots()) {
      if (slot.path !== undefined) slot.apply();
    }
  }

  private _disposeMesh(): void {
    if (!this._mesh) return;
    this.gameObject._object3D.remove(this._mesh);
    this._mesh.geometry.dispose();
    (this._mesh.material as THREE.Material).dispose();
    this._mesh = null;
    // Fase 11B.1/11B.2 — rilascia il riferimento a ciascuna delle 6 mappe
    // texture trattenuto da questa istanza (se presente): mai lasciare un
    // riferimento refcounted (o una sottoscrizione a invalidateTexture)
    // vivi dopo che il materiale che li usava è stato disposto, stesso
    // principio già seguito per geometria/materiale sopra.
    for (const slot of this._allTextureSlots()) {
      slot.release();
    }
  }

  override onDestroy(): void {
    this._disposeMesh();
  }
}

function geometryForShape(shape: MeshShape): THREE.BufferGeometry {
  const geometry = buildGeometryForShape(shape);
  // Fase 11B.2 — `aoMap` (ambient occlusion) richiede un SECONDO canale UV
  // (`uv2`) per funzionare in three.js: senza, `MeshStandardMaterial` non
  // applica affatto la mappa AO, silenziosamente (nessun errore, nessun
  // warning). Nessuna delle primitive di three.js (`BoxGeometry`/
  // `SphereGeometry`/`PlaneGeometry`) genera `uv2` da sé — verificato sul
  // sorgente three.js, non assunto. Riusare l'attributo `uv` già generato
  // come `uv2` è il workaround standard per un secondo set di coordinate
  // "buono abbastanza" quando (come qui) non serve un layout UV dedicato
  // per l'AO — nessun costo aggiuntivo se `aoMap` non viene mai assegnata
  // (l'attributo resta semplicemente inutilizzato dal materiale). Le 3
  // primitive generano SEMPRE un attributo `uv` (verificato sul sorgente
  // three.js) — il fallback sotto è solo per soddisfare il tipo
  // (`BufferAttribute | undefined`), non un caso atteso a runtime.
  const uv = geometry.attributes.uv;
  if (uv) geometry.setAttribute("uv2", uv);
  return geometry;
}

function buildGeometryForShape(shape: MeshShape): THREE.BufferGeometry {
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
