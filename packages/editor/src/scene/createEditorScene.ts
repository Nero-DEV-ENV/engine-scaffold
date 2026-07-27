import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  Engine,
  GameObject,
  Destroy,
  MeshRenderer,
  Component,
  createRenderer,
  createBasicLighting,
  OrbitCameraController,
  initPhysics,
  Physics,
  _resetPhysics,
} from "@engine/core";
import type { SceneData, TransformData, MeshShape, ComponentData, ComponentTypeName } from "@engine/core";
import {
  serializeTransform,
  applyTransformData,
  serializeComponent,
  applyComponentData,
  updateComponentData,
  attachGLTF,
} from "@engine/core";
import { findOwningGameObject, flattenGameObjects } from "./hierarchy.js";
import { loadSceneReplacingCurrent } from "./sceneLoad.js";
import { selectionStore, sceneRootsStore, bumpTransformVersion } from "../store/editorStore.js";
import { getAssetObjectURL } from "../assets/assetsController.js";
import {
  sendTransformCommit,
  sendBeginEdit,
  sendEndEdit,
  sendAddGameObject,
  sendRemoveGameObject,
  sendAddComponent,
  sendRemoveComponent,
  sendUpdateComponent,
  editingByStore,
  presenceStore,
  mySessionIdStore,
} from "../network/collabClient.js";

/**
 * createEditorScene — bootstrap imperativo della scena three.js/@engine/core
 * per il viewport dell'editor. Stesso stile di apps/playground/src/main.ts
 * (Fase 2/3): nessuna astrazione React qui dentro, solo Engine/GameObject/
 * renderer — il componente React (Viewport.tsx) si limita a chiamare questa
 * funzione una volta e a inoltrarle i resize del suo container.
 *
 * Scena demo Fase 4A: un piano + due primitive (Cube/Sphere), nessuna
 * gerarchia parent/child ancora — la Hierarchy vera arriva in Fase 4B e per
 * ora non ha bisogno di altro che GameObject "piatti" da elencare.
 *
 * Fase 4B: espone `roots` (i GameObject radice, consumati da Hierarchy.tsx
 * tramite scene/hierarchy.ts) e gestisce qui la selezione via click/raycast
 * sul canvas più l'highlight visivo dell'oggetto selezionato, leggendo e
 * scrivendo `selectionStore` — così un click su una riga di Hierarchy si
 * riflette nel Viewport (e viceversa) senza che questo modulo sappia nulla
 * di React, e senza che i pannelli React sappiano nulla di three.js.
 *
 * Fase 4C: aggiunge `TransformControls` (addon three.js) collegato al
 * GameObject selezionato. API verificata empiricamente sui tipi installati
 * (three 0.185.1, vedi node_modules/@types/three): l'helper visivo va
 * aggiunto alla scena via `.getHelper()`, non con `scene.add(controls)`
 * come nelle versioni precedenti di three.js. La sincronizzazione
 * gizmo→Object3D è automatica e gratuita (il loop di rendering richiama
 * `renderer.render(scene, camera)` ad ogni frame, e l'helper ricalcola la
 * propria posizione dalla matrice mondo dell'oggetto agganciato ad ogni
 * frame): non serve alcun codice di sync esplicito per quella direzione.
 * La direzione opposta (un campo Inspector modificato deve "spostare" il
 * gizmo) funziona per lo stesso motivo, gratis: Inspector.tsx scrive
 * direttamente su `transform.setPosition`/ecc., il prossimo frame del loop
 * fa il resto. L'unica sincronizzazione che richiede codice esplicito è
 * gizmo→Inspector (i campi numerici devono aggiornarsi mentre si trascina),
 * gestita con `transformVersionStore`/`bumpTransformVersion` (vedi
 * store/editorStore.ts) sull'evento "objectChange" di TransformControls.
 */

export interface EditorSceneHandle {
  readonly engine: Engine;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /**
   * GameObject radice della scena AL MOMENTO DELLA CREAZIONE di questo
   * handle (vedi scene/hierarchy.ts) — un `loadScene()` successivo aggiorna
   * i roots interni e `sceneRootsStore`, ma NON questo campo (snapshot,
   * come Instantiate/deserializeScene non aggiornano riferimenti già
   * presi altrove): per i roots correnti dopo un load, leggere
   * `sceneRootsStore` (store/editorStore.ts), che è la fonte di verità
   * usata anche da Hierarchy.tsx.
   */
  readonly roots: readonly GameObject[];
  /**
   * Sostituisce la scena corrente con quella descritta da `data`
   * (equivalente di `SceneManager.LoadScene` in Unity): distrugge ogni
   * GameObject vivo sotto i roots correnti (vedi scene/sceneLoad.ts),
   * deserializza `data` al suo posto, e resetta la selezione a null (il
   * GameObject selezionato prima del load non esiste più — gizmo e
   * highlight si aggiornano da soli tramite le loro subscription a
   * `selectionStore`).
   */
  loadScene(data: SceneData): void;
  /**
   * Fase 6C.1 — crea un nuovo GameObject radice e lo aggiunge alla scena
   * viva: "empty" produce un GameObject senza componenti (stesso
   * trattamento delle luci demo — niente highlight/raycast possibile,
   * nessuna Mesh); "box"/"sphere"/"plane" aggiungono anche un MeshRenderer
   * con una forma di default (vedi `shapeForKind` sotto). `name`, se
   * assente, ricade su un nome di default per kind (vedi
   * `defaultNameForKind`); non c'è deduplicazione dei nomi, coerente col
   * resto dell'editor (l'id, non il nome, è l'identificatore univoco di un
   * GameObject).
   *
   * Fase 6C.2 estende la firma con `options`, tutti opzionali e retro-
   * compatibili (una chiamata `addGameObject(kind)` da Hierarchy.tsx si
   * comporta esattamente come prima):
   * - `id`: id esplicito da assegnare (passato al costruttore di
   *   `GameObject`, che lo accetta già come secondo parametro opzionale —
   *   nessuna modifica al core necessaria). Se assente, `GameObject` genera
   *   un `crypto.randomUUID()` come sempre. Usato dalla ricostruzione
   *   remota (collabClient.ts) per assegnare lo STESSO id deciso dal client
   *   creatore, così l'oggetto è riconosciuto come "lo stesso" da tutti i
   *   client.
   * - `transform`: se presente, applicato SUBITO dopo la creazione invece
   *   di lasciare l'oggetto all'origine (0,0,0) — usato dalla ricostruzione
   *   remota per posizionare l'oggetto dov'era quando è stato creato/
   *   spostato dal client originario.
   * - `select` (default `true`): se `false`, non seleziona l'oggetto appena
   *   creato — usato dalla ricostruzione remota per non rubare la
   *   selezione locale dell'utente quando arriva un oggetto creato da un
   *   ALTRO client.
   * - `broadcast` (default `true`): se `false`, non invia `addGameObject`
   *   al server — usato dalla ricostruzione remota, per non ri-mandare al
   *   server un oggetto che il server stesso ha appena broadcastato (vedi
   *   collabClient.ts). Quando `true` (default, chiamata locale da
   *   Hierarchy.tsx), il messaggio `addGameObject{id, kind, name,
   *   transform}` viene inviato al server SUBITO dopo la creazione locale
   *   ottimistica — no-op se non connessi (stesso pattern già usato da
   *   `sendTransformCommit`).
   */
  addGameObject(
    kind: "empty" | "box" | "sphere" | "plane",
    name?: string,
    options?: { id?: string; transform?: TransformData; select?: boolean; broadcast?: boolean },
  ): GameObject;
  /**
   * Fase 6C.1 — rimuove un GameObject dalla scena viva. Usa `Destroy()` di
   * `@engine/core`: la rimozione dal grafo three.js è deferred a fine frame
   * dal game loop dell'Engine (verificato in Scene.ts/Engine.ts —
   * `_flushPendingDestroys()` gira ad ogni frame), quindi non serve alcuna
   * chiamata esplicita a `scene.remove()` qui. Se `gameObject` è quello
   * attualmente selezionato, la selezione viene resettata a `null` — questo
   * fa scattare da sole le subscription già esistenti su `selectionStore`
   * (gizmo/highlight, vedi sopra), nessun'altra pulizia da scrivere qui per
   * quei due sistemi.
   *
   * Fase 6C.2 estende la firma con `options.broadcast` (default `true`,
   * stesso significato/scopo di `addGameObject` sopra): quando `true`
   * (chiamata locale da Inspector.tsx), invia `removeGameObject
   * {gameObjectId}` al server SUBITO DOPO la rimozione locale (l'id va letto
   * PRIMA di `Destroy()`, non dopo). Quando `false`, usato dalla rimozione
   * remota innescata da collabClient.ts alla ricezione di un
   * `removeGameObject` broadcastato dal server.
   */
  removeGameObject(gameObject: GameObject, options?: { broadcast?: boolean }): void;
  /**
   * Fase 6D — aggiunge `data` come nuovo componente di `gameObject`. Lancia
   * se `gameObject` ha già un componente dello stesso `data.type` (mirror
   * del vincolo di `GameObject.addComponent` nel motore — vedi
   * core/GameObject.ts): il chiamante (menu "Aggiungi componente" in
   * Inspector.tsx) deve già filtrare i tipi presenti, quindi non dovrebbe
   * mai accadere da UI; il percorso remoto (collabClient.ts) verifica
   * l'esistenza PRIMA di chiamare questo metodo, per lo stesso motivo.
   *
   * `options.broadcast` (default `true`, stesso significato di
   * `addGameObject`/`removeGameObject`): quando `true` (chiamata locale da
   * Inspector.tsx), invia `addComponent{gameObjectId, component}` al
   * server SUBITO dopo la creazione locale ottimistica. Quando `false`,
   * usato dalla ricostruzione remota in collabClient.ts.
   */
  addComponent(gameObject: GameObject, data: ComponentData, options?: { broadcast?: boolean }): Component;
  /**
   * Fase 6D — rimuove il componente di tipo `type` da `gameObject`, se
   * presente. No-op silenzioso se `gameObject` non ha un componente di
   * quel tipo — stesso stile "richiesta ignorata silenziosamente su intent
   * non valido" già usato da `removeGameObject`. Stesso significato di
   * `options.broadcast` delle altre funzioni di questa interfaccia.
   */
  removeComponent(gameObject: GameObject, type: ComponentTypeName, options?: { broadcast?: boolean }): void;
  /**
   * Fase 6D — aggiorna i campi del componente di tipo `data.type` già
   * presente su `gameObject` (semantica OPPOSTA di `addComponent`: no-op
   * silenzioso se il componente NON esiste ancora, invece che se esiste
   * già). Stesso significato di `options.broadcast` delle altre funzioni.
   */
  updateComponent(gameObject: GameObject, data: ComponentData, options?: { broadcast?: boolean }): void;
  /**
   * Fase 7 — crea un nuovo GameObject radice a partire da un asset GLTF/GLB
   * già importato nel pannello Assets: `assetId` è l'id restituito da
   * `assetsController.importAssetFile` (persistito in IndexedDB, vedi
   * AssetPersistence.ts), `name` il nome mostrato in Hierarchy/Inspector
   * (di norma il nome del file). A differenza di `addGameObject`, questa
   * funzione è ASINCRONA: il caricamento della gerarchia three.js
   * (`attachGLTF`) richiede di risolvere l'asset a un object URL e passare
   * da GLTFLoader, entrambi asincroni. Il GameObject risultante ha
   * `sourceAssetId` impostato ad `assetId` (letto da SceneSerializer al
   * momento del Save, per poter ricostruire il modello dopo un futuro
   * Load — vedi il commento su `GameObjectData.sourceAssetId` in
   * @engine/core) ed è selezionato automaticamente al termine del
   * caricamento, stesso comportamento di default di `addGameObject`.
   *
   * Nessun parametro `broadcast`/sync collaborativo in questa fase (punto
   * non coperto dai punti aperti 1-5 confermati): l'import di asset resta
   * un'operazione locale al singolo editor, non sincronizzata via
   * Colyseus fra client collegati alla stessa sessione.
   */
  addImportedModel(assetId: string, name: string): Promise<GameObject>;
  /** Da chiamare ad ogni resize del container (via ResizeObserver, non window resize — vedi Viewport.tsx). */
  setSize(width: number, height: number): void;
  /** Ferma il loop, rilascia renderer/controls/listener e libera il registry globale dei GameObject (vedi Scene.ts). */
  dispose(): void;
}

/** Spostamento massimo (px) fra pointerdown e pointerup perché conti come click di selezione e non come drag dell'orbit control. */
const CLICK_MOVE_THRESHOLD_PX = 4;

function hasVisibleGeometry(object3D: THREE.Object3D): boolean {
  let found = false;
  object3D.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

/**
 * Fase 6C.1 — forma di default per ciascuna primitiva creabile da
 * `EditorSceneHandle.addGameObject`. Dimensioni scelte per essere
 * ragionevoli fianco a fianco con la scena demo esistente (Cube 1×1×1 e
 * Sphere raggio 0.5 in createEditorScene sopra usano gli stessi valori;
 * Plane 1×1 deliberatamente più piccolo del Ground demo 10×10, per non
 * essere confuso con un secondo pavimento).
 */
function shapeForKind(kind: "box" | "sphere" | "plane"): MeshShape {
  switch (kind) {
    case "box":
      return { kind: "box", size: { x: 1, y: 1, z: 1 } };
    case "sphere":
      return { kind: "sphere", radius: 0.5 };
    case "plane":
      return { kind: "plane", width: 1, height: 1 };
  }
}

/** Fase 6C.1 — nome di default assegnato da `addGameObject` quando il chiamante non ne fornisce uno esplicito. */
function defaultNameForKind(kind: "empty" | "box" | "sphere" | "plane"): string {
  switch (kind) {
    case "empty":
      return "GameObject";
    case "box":
      return "Cube";
    case "sphere":
      return "Sphere";
    case "plane":
      return "Plane";
  }
}

/**
 * Fase 6D — trova il componente di tipo `type` già presente su
 * `gameObject`, o `null` se assente. Usa `serializeComponent` (invece di
 * una mappa `ComponentTypeName` → classe concreta, che duplicherebbe lo
 * switch già esaustivo dentro `serializeComponent`/`applyComponentData` in
 * SceneSerializer.ts) per confrontare il `type` di ciascun componente
 * presente — `getComponents(Component)` (classe base astratta, API
 * pubblica già esistente) restituisce OGNI componente indipendentemente
 * dal tipo concreto.
 */
function findComponentByType(gameObject: GameObject, type: ComponentTypeName): Component | null {
  return gameObject.getComponents(Component).find((c) => serializeComponent(c)?.type === type) ?? null;
}

/** Fase 6D — tutti i componenti CORRENTI di `gameObject`, serializzati (usato dal payload `addGameObject` broadcast e da un futuro hydrate lato editor). */
function serializeComponentsOf(gameObject: GameObject): ComponentData[] {
  return gameObject
    .getComponents(Component)
    .map(serializeComponent)
    .filter((data): data is ComponentData => data !== null);
}

export async function createEditorScene(container: HTMLElement): Promise<EditorSceneHandle> {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  // Non passiamo `container` a createRenderer: appendiamo il canvas noi
  // stessi qui sotto, dopo avergli dato la classe CSS che lo dimensiona
  // al 100% del pannello (vedi App.css) — stesso risultato del parametro
  // `container`, ma esplicito sul fatto che le dimensioni reali arrivano
  // dal CSS del pannello, non da createRenderer.
  const { renderer } = await createRenderer({ width, height });
  renderer.domElement.classList.add("viewport-canvas");
  container.appendChild(renderer.domElement);

  // Fase 6B.client-2: CSS2DRenderer (addon three/examples/jsm, stesso
  // pattern di TransformControls sopra — nessuna dipendenza nuova) per
  // l'etichetta di testo SEMPRE visibile (colore+nome) su un oggetto
  // lockato da un altro client — vedi lockVisuals/updateLockVisuals più
  // sotto. `container` è già `position: relative` in App.css
  // (.viewport-panel), quindi il layer assoluto del CSS2DRenderer si
  // sovrappone correttamente al canvas WebGL sottostante.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(width, height);
  labelRenderer.domElement.classList.add("viewport-labels");
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d21);

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  camera.position.set(4, 3, 6);

  const cameraController = new OrbitCameraController(camera, renderer.domElement);
  cameraController.setTarget(0, 0.5, 0);

  // Fase 6B.client-1: id ESPLICITI e stabili per tutti e cinque i
  // GameObject della scena demo (le due luci qui sotto + Ground/Cube/Sphere
  // poco più in basso), invece del `crypto.randomUUID()` di default —
  // scoperto un problema reale con uno smoke-test in due tab browser: due
  // istanze fresche dell'editor generavano id casuali diversi per "lo
  // stesso" Cube logico, quindi il sync Colyseus (keyed per gameObjectId)
  // non li riconosceva mai come lo stesso oggetto — un client spostava il
  // proprio, l'altro non vedeva nulla, finché non si allineavano gli id a
  // mano con Save/Load. Con id fissi, due tab/utenti che aprono l'editor
  // "a freddo" condividono già la stessa scena di base, senza passaggi
  // manuali. Non riguarda una scena salvata/caricata (Save/Load preserva
  // già l'id originale di ogni GameObject, vedi SceneSerializer.ts) né un
  // futuro GameObject aggiunto in sessione (Fase 6C, che sincronizzerà
  // anche l'aggiunta stessa, non solo il Transform) — solo il bootstrap
  // demo hardcoded qui sotto.
  const lighting = createBasicLighting({ ambientId: "demo-ambient-light", keyLightId: "demo-key-light" });
  scene.add(lighting.ambient._object3D, lighting.keyLight._object3D);

  // ---- Fisica (Fase 5C.1) ----------------------------------------------
  // await PRIMA di aggiungere qualunque RigidBody/Collider e prima di
  // engine.start() più sotto — stesso pattern/motivo di apps/playground/
  // src/main.ts (vedi il commento su initPhysics in
  // packages/core/src/physics/Physics.ts): se l'Engine iniziasse a
  // ticchettare (o un Load caricasse RigidBody/Collider) prima che il WASM
  // di Rapier sia pronto, Physics.step() fallirebbe rumorosamente. Nessuno
  // dei tre GameObject demo qui sotto ha ancora componenti fisici — questa
  // fase collega solo il World, la fisica reale nell'editor arriva oggi
  // solo da un Load di una scena salvata che contiene RigidBody/Collider
  // (vedi Inspector.tsx: l'editor non ha ancora una UI "Add Component").
  await initPhysics();

  // Ground/Cube/Sphere usano MeshRenderer (Fase 5) invece di una THREE.Mesh
  // costruita a mano: la rappresentazione visiva (forma/colore) diventa così
  // un dato leggibile da SceneSerializer, non più codice imperativo qui —
  // condizione necessaria perché la scena sopravviva a un ciclo save/load
  // (deliverable di questa fase). MeshRenderer.shape "plane" è già
  // orizzontale di default (vedi MeshRenderer.ts), quindi la rotazione
  // correttiva che prima veniva applicata qui a mano non serve più.
  const groundGO = new GameObject("Ground", "demo-ground");
  const groundRenderer = groundGO.addComponent(MeshRenderer);
  groundRenderer.shape = { kind: "plane", width: 10, height: 10 };
  groundRenderer.color = 0x2f3237;
  scene.add(groundGO._object3D);

  const cubeGO = new GameObject("Cube", "demo-cube");
  cubeGO.transform.setPosition(-1, 0.5, 0);
  const cubeRenderer = cubeGO.addComponent(MeshRenderer);
  cubeRenderer.shape = { kind: "box", size: { x: 1, y: 1, z: 1 } };
  cubeRenderer.color = 0x4f8ef7;
  scene.add(cubeGO._object3D);

  const sphereGO = new GameObject("Sphere", "demo-sphere");
  sphereGO.transform.setPosition(1, 0.5, 0);
  const sphereRenderer = sphereGO.addComponent(MeshRenderer);
  sphereRenderer.shape = { kind: "sphere", radius: 0.5 };
  sphereRenderer.color = 0xe0663f;
  scene.add(sphereGO._object3D);

  // Ordine di Hierarchy: prima i GameObject "visibili" della scena demo,
  // le luci in coda. AmbientLight/KeyLight sono GameObject a tutti gli
  // effetti (createBasicLighting li crea con new GameObject(...), Fase 2)
  // e questa fase li tratta come nodi Hierarchy normali e selezionabili,
  // senza alcun caso speciale nel codice: non hanno una Mesh, quindi non
  // possono essere colpiti da un raycast dal Viewport (nessuna geometria
  // da intersecare) e non ricevono un highlight visivo quando selezionati
  // (vedi hasVisibleGeometry/updateHighlight sotto) — sono conseguenze
  // dirette dell'assenza di geometria, non un ramo if aggiunto apposta per
  // loro. L'alternativa di nasconderli avrebbe reso la Hierarchy "non
  // reale" rispetto allo stato vero della scena, contraddicendo l'obiettivo
  // di questa fase; trattarli "non selezionabili" via un flag dedicato
  // avrebbe aggiunto stato/complessità per un limite che emerge già da solo
  // dalla mancanza di geometria.
  // `let`, non `const`: `loadScene` (Fase 5B) sostituisce l'intero array
  // quando la scena viene ricaricata da IndexedDB — vedi anche
  // `rootObject3Ds` sotto, che deve restare sincronizzato per il raycast
  // di selezione.
  let roots: GameObject[] = [groundGO, cubeGO, sphereGO, lighting.ambient, lighting.keyLight];

  // ---- Gizmo di trasformazione (Fase 4C) --------------------------------
  // Istanziato PRIMA di registrare qui sotto i listener pointerdown/pointerup
  // di selezione: il costruttore di TransformControls collega i propri
  // listener nativi al domElement (via `connect()`), quindi su un dato
  // evento pointerdown del browser il suo handler interno gira per primo e
  // imposta subito `dragging = true` se il pointer ha colpito il gizmo —
  // onPointerDown (sotto) può quindi leggere `transformControls.dragging`
  // per riconoscere "questo press è iniziato sul gizmo" e ignorarlo del
  // tutto ai fini della selezione, invece di affidarsi solo alla soglia di
  // movimento (che da sola intercetterebbe un vero drag, ma non un click
  // secco sul gizmo che non sposta il mouse).
  const transformControls = new TransformControls(camera, renderer.domElement);
  const gizmoHelper = transformControls.getHelper();
  scene.add(gizmoHelper);

  // Il gizmo si aggancia a QUALUNQUE GameObject selezionato, non solo a
  // quelli con Mesh (a differenza di updateHighlight/hasVisibleGeometry più
  // sotto): sposta il Transform (posizione/rotazione/scala dell'Object3D),
  // operazione che non richiede alcun bounding box — un vincolo diverso da
  // quello del BoxHelper, quindi una regola diversa qui è corretta e non un
  // ramo if arbitrario. Muovere una luce (AmbientLight/KeyLight) con il
  // gizmo ha senso quanto muovere un GameObject con Mesh: cambia comunque
  // transform.position, che per la KeyLight direzionale ha un effetto
  // visivo reale sulla scena; per l'AmbientLight la posizione non
  // influenza il rendering, ma questo è già vero indipendentemente dal
  // gizmo — non un motivo per trattare le luci diversamente in questo
  // punto del codice.
  // Fase 6B.client-2: un gameObjectId presente in editingByStore con un
  // sessionId DIVERSO dal proprio è lockato da un altro client — il
  // proprio gizmo non deve potersi agganciare a quell'oggetto (decisione
  // presa con l'utente: "gli altri client... disabilitano il proprio
  // gizmo su quell'oggetto"). Un lock con sessionId UGUALE al proprio è il
  // proprio stesso lock (drag in corso), il gizmo deve restare agganciato
  // normalmente.
  function isLockedByOther(gameObjectId: string): boolean {
    const holder = editingByStore.get().get(gameObjectId);
    return holder !== undefined && holder !== mySessionIdStore.get();
  }

  function updateGizmoTarget(selected: GameObject | null): void {
    if (selected && !isLockedByOther(selected.id)) {
      transformControls.attach(selected._object3D);
    } else {
      transformControls.detach();
    }
  }

  updateGizmoTarget(selectionStore.get());
  const unsubscribeGizmoTarget = selectionStore.subscribe(() => {
    updateGizmoTarget(selectionStore.get());
  });
  // Il lock può arrivare/sparire DOPO che l'oggetto è già selezionato
  // localmente (un altro client inizia/finisce un drag sull'oggetto che ho
  // selezionato io): ririsolvere il target del gizmo anche ad ogni cambio
  // di editingByStore, non solo di selectionStore.
  const unsubscribeGizmoLock = editingByStore.subscribe(() => {
    updateGizmoTarget(selectionStore.get());
  });

  // Disabilita l'OrbitCameraController mentre si trascina il gizmo:
  // altrimenti i due controlli si contenderebbero lo stesso drag sul canvas
  // (l'orbit ruoterebbe la camera mentre il gizmo tenta di spostare
  // l'oggetto). `event.value` è tipizzato `unknown` nell'event map generico
  // di TransformControls (vedi il .d.ts installato in @types/three): a
  // runtime è però sempre il nuovo valore booleano di `dragging`, una
  // proprietà definita con lo stesso pattern get/set-con-dispatch di tutte
  // le altre proprietà "-changed" dei Controls tre.js (verificato leggendo
  // TransformControls.js in node_modules, non assunto dal solo .d.ts).
  //
  // Fase 6B.client-1: stesso evento usato anche per inviare `commitTransform`
  // a fine trascinamento (`event.value === false`), non ad ogni tick — il
  // GameObject trascinato è sempre quello agganciato al gizmo, cioè
  // `selectionStore.get()` (vedi updateGizmoTarget sopra: il gizmo segue
  // sempre la selezione corrente). `sendTransformCommit` è no-op se non
  // connessi a nessuna sessione, quindi questo non cambia alcun
  // comportamento quando la feature non è attiva.
  //
  // Fase 6B.client-2: lo stesso evento invia anche `beginEdit`/`endEdit`
  // per il lock ottimistico — `beginEdit` a inizio drag (`event.value ===
  // true`), `endEdit` a fine drag insieme a `commitTransform` (stesso
  // punto, stesso ordine delle decisioni prese con l'utente: il rilascio
  // del lock è garantito dallo stesso evento che chiude il commit,
  // nessun timeout). Non serve controllare qui se l'oggetto è lockato da
  // un altro client: `updateGizmoTarget` (sopra) ha già scollegato il
  // gizmo in quel caso, quindi questo evento non può scattare per un
  // oggetto lockato da qualcun altro.
  transformControls.addEventListener("dragging-changed", (event) => {
    const dragging = event.value as boolean;
    cameraController.enabled = !dragging;
    const selected = selectionStore.get();
    if (dragging) {
      if (selected) sendBeginEdit(selected.id);
    } else if (selected) {
      const transformData: TransformData = serializeTransform(selected);
      sendTransformCommit(selected.id, transformData);
      sendEndEdit(selected.id);
    }
  });

  // Bump del contatore ad ogni modifica del Transform trascinando il
  // gizmo: Inspector.tsx vi si sottoscrive per ridisegnare i campi numerici
  // con i valori aggiornati mentre l'utente trascina (vedi
  // transformVersionStore/bumpTransformVersion in store/editorStore.ts).
  transformControls.addEventListener("objectChange", () => {
    bumpTransformVersion();
  });

  // ---- Selezione: raycast dal click sul canvas ------------------------

  const raycaster = new THREE.Raycaster();
  // `let`, non `const`: aggiornato da `loadScene` insieme a `roots`, così il
  // raycast di selezione colpisce sempre la scena corrente, non quella al
  // momento del bootstrap.
  let rootObject3Ds = roots.map((go) => go._object3D);
  let pointerDownPosition: { x: number; y: number } | null = null;

  function onPointerDown(event: PointerEvent): void {
    // Vedi il commento sopra la creazione di `transformControls`: se il
    // press ha già colpito il gizmo (dragging passato a true dal listener
    // nativo di TransformControls, che gira prima di questo), non lo
    // trattiamo come un possibile click di selezione.
    if (transformControls.dragging) return;
    pointerDownPosition = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent): void {
    const startPosition = pointerDownPosition;
    pointerDownPosition = null;
    if (!startPosition) return;

    const dx = event.clientX - startPosition.x;
    const dy = event.clientY - startPosition.y;
    // Spostamento oltre soglia: era un drag dell'OrbitCameraController,
    // non un click di selezione — altrimenti ogni orbit-drag cambierebbe
    // la selezione al rilascio del mouse.
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD_PX) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    // Solo contro le radici tracciate, non `scene.children`: esclude
    // automaticamente l'highlight helper (aggiunto direttamente a `scene`,
    // vedi updateHighlight) dal test di intersezione, senza doverlo
    // filtrare esplicitamente dai risultati.
    const hits = raycaster.intersectObjects(rootObject3Ds, true);
    const hitObject3D = hits[0]?.object ?? null;
    // Click su spazio vuoto del Viewport: deseleziona (comportamento
    // comune negli editor 3D). Click su una riga della Hierarchy invece
    // seleziona sempre, non è mai un toggle — vedi Hierarchy.tsx.
    selectionStore.set(hitObject3D ? findOwningGameObject(hitObject3D) : null);
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  // ---- Highlight visivo della selezione --------------------------------

  let highlightHelper: THREE.BoxHelper | null = null;

  function updateHighlight(selected: GameObject | null): void {
    if (highlightHelper) {
      scene.remove(highlightHelper);
      highlightHelper.dispose();
      highlightHelper = null;
    }
    // Niente highlight per GameObject senza Mesh (es. le luci): un
    // THREE.BoxHelper su un Object3D privo di geometria calcolerebbe un
    // bounding box vuoto/degenere — non verificabile a schermo qui (nessun
    // browser in sandbox), quindi lo evitiamo esplicitamente invece di
    // fidarci di una degradazione implicita che non possiamo controllare.
    if (selected && hasVisibleGeometry(selected._object3D)) {
      highlightHelper = new THREE.BoxHelper(selected._object3D, 0xffbb33);
      scene.add(highlightHelper);
    }
  }

  updateHighlight(selectionStore.get());
  const unsubscribeSelection = selectionStore.subscribe(() => {
    updateHighlight(selectionStore.get());
  });

  // ---- Highlight+etichetta per il lock di editing di un altro client ----
  // (Fase 6B.client-2). Distinto dall'highlight di selezione sopra: un
  // oggetto può essere selezionato E lockato da un altro client
  // contemporaneamente (il gizmo in quel caso è già scollegato da
  // updateGizmoTarget, ma l'highlight di selezione arancione resterebbe
  // comunque visibile — non un conflitto, sono due indicatori con
  // significati diversi: "cosa ho selezionato io" vs "chi sta editando
  // cosa"). Colore+nome SEMPRE visibili (deciso con l'utente, non solo
  // al hover) — l'etichetta usa CSS2DRenderer/CSS2DObject invece di un
  // helper three.js nativo, perché serve testo leggibile a schermo, non
  // solo geometria.

  interface LockVisual {
    readonly boxHelper: THREE.BoxHelper;
    readonly label: CSS2DObject;
    readonly labelDiv: HTMLDivElement;
  }

  const lockVisuals = new Map<string, LockVisual>();
  const reusableLockBox = new THREE.Box3();

  /** Posiziona l'etichetta sopra il bounding box world-space corrente dell'oggetto, ricalcolato ogni frame (vedi loop dell'Engine sotto). */
  function updateLockLabelPosition(object3D: THREE.Object3D, label: CSS2DObject): void {
    reusableLockBox.setFromObject(object3D);
    if (reusableLockBox.isEmpty()) {
      label.position.copy(object3D.position);
      return;
    }
    label.position.set(
      (reusableLockBox.min.x + reusableLockBox.max.x) / 2,
      reusableLockBox.max.y + 0.3,
      (reusableLockBox.min.z + reusableLockBox.max.z) / 2,
    );
  }

  function removeLockVisual(gameObjectId: string): void {
    const visual = lockVisuals.get(gameObjectId);
    if (!visual) return;
    scene.remove(visual.boxHelper);
    visual.boxHelper.dispose();
    scene.remove(visual.label);
    visual.labelDiv.remove();
    lockVisuals.delete(gameObjectId);
  }

  /**
   * Ricalcola l'insieme di highlight+etichette da mostrare confrontando
   * `editingByStore` (chi sta editando cosa) con `mySessionIdStore` (per
   * escludere il proprio stesso lock — vedi isLockedByOther sopra) e
   * `presenceStore` (per risolvere sessionId → nome+colore). Chiamata ad
   * ogni cambio di uno qualunque dei tre store (subscription sotto), non
   * solo al cambio di selezione: un lock può apparire/sparire per un
   * qualunque gameObjectId indipendentemente da cosa ho selezionato io.
   */
  function updateLockVisuals(): void {
    const editingBy = editingByStore.get();
    const presence = presenceStore.get();
    const mySessionId = mySessionIdStore.get();

    const activeIds = new Set<string>();
    for (const [gameObjectId, sessionId] of editingBy) {
      if (sessionId === mySessionId) continue; // il proprio stesso lock non mostra highlight
      const go = flattenGameObjects(roots).find((candidate) => candidate.id === gameObjectId) ?? null;
      // gameObjectId sconosciuto localmente (scena diversa fra client,
      // stesso limite già presente in collabClient.ts per i Transform —
      // 6C non ancora arrivata) o senza geometria visibile: nessun
      // highlight possibile/sensato, stesso criterio di updateHighlight.
      if (!go || !hasVisibleGeometry(go._object3D)) continue;
      const info = presence.get(sessionId);
      // Presence non ancora arrivata per questo sessionId (race fra
      // l'evento editingBy e l'evento clients — entrambi via Colyseus,
      // ordine non garantito): salta per questo giro, si aggiornerà da
      // solo al prossimo evento di uno dei due store.
      if (!info) continue;

      activeIds.add(gameObjectId);
      let visual = lockVisuals.get(gameObjectId);
      if (!visual) {
        const boxHelper = new THREE.BoxHelper(go._object3D, new THREE.Color(info.color));
        scene.add(boxHelper);
        const labelDiv = document.createElement("div");
        labelDiv.className = "lock-label";
        const dot = document.createElement("span");
        dot.className = "lock-label-dot";
        dot.style.backgroundColor = info.color;
        const nameSpan = document.createElement("span");
        nameSpan.className = "lock-label-name";
        nameSpan.textContent = info.name;
        labelDiv.appendChild(dot);
        labelDiv.appendChild(nameSpan);
        const label = new CSS2DObject(labelDiv);
        scene.add(label);
        visual = { boxHelper, label, labelDiv };
        lockVisuals.set(gameObjectId, visual);
      } else {
        // Il colore/nome di un client non cambia durante la sua
        // connessione (assegnati una volta al join, vedi EditorRoom.ts) —
        // ma se in futuro dovesse cambiare, questo tiene l'etichetta
        // coerente invece di mostrare dati stale.
        visual.boxHelper.material.color.set(info.color);
        (visual.labelDiv.firstElementChild as HTMLElement).style.backgroundColor = info.color;
        (visual.labelDiv.lastElementChild as HTMLElement).textContent = info.name;
      }
    }

    for (const gameObjectId of Array.from(lockVisuals.keys())) {
      if (!activeIds.has(gameObjectId)) removeLockVisual(gameObjectId);
    }
  }

  updateLockVisuals();
  const unsubscribeEditingByVisuals = editingByStore.subscribe(updateLockVisuals);
  const unsubscribePresenceVisuals = presenceStore.subscribe(updateLockVisuals);

  const engine = new Engine(
    (dt) => {
      cameraController.update(dt);
      // Ricalcola il box dell'highlight ad ogni frame, non solo al cambio
      // selezione: ora che il gizmo (Fase 4C) può spostare l'oggetto
      // selezionato mentre resta selezionato, il box degenererebbe (resterebbe
      // fermo alla posizione di quando è stato creato) senza questo update
      // per-frame.
      highlightHelper?.update();
      // Fase 6B.client-2: stesso motivo per gli highlight+etichette di
      // lock — l'oggetto lockato da un altro client riceve la sua nuova
      // posizione solo al prossimo commitTransform (vedi collabClient.ts),
      // ma quando arriva il box/etichetta devono seguirla senza attendere
      // un ricalcolo esplicito da qui.
      for (const [gameObjectId, visual] of lockVisuals) {
        const go = flattenGameObjects(roots).find((candidate) => candidate.id === gameObjectId);
        if (!go) continue;
        visual.boxHelper.update();
        updateLockLabelPosition(go._object3D, visual.label);
      }
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    },
    // Fase 5C.1 — stesso `Physics.step` passato da apps/playground/src/main.ts:
    // un RigidBody/Collider caricato in editor (oggi solo via Load, vedi il
    // commento su initPhysics più sopra) viene ora davvero simulato in preview,
    // non più solo dato serializzato inerte.
    Physics.step
  );
  engine.start();

  /**
   * loadScene — vedi il commento su `EditorSceneHandle.loadScene`. La
   * pulizia/ricostruzione vera e propria vive in `scene/sceneLoad.ts`
   * (testabile in automatico, non tocca API browser): qui ci limitiamo ad
   * aggiornare lo stato che SOLO questa closure possiede (`roots`,
   * `rootObject3Ds` per il raycast) e gli store React (`sceneRootsStore`
   * per Hierarchy, `selectionStore` per gizmo/highlight).
   *
   * Fase 5C.4 — `loadSceneReplacingCurrent` costruisce la nuova scena PRIMA
   * di distruggere quella corrente: se `data` è corrotto/malformato,
   * l'eccezione propaga da lì senza che questa funzione arrivi mai a
   * riassegnare `roots`/gli store sotto — l'editor resta esattamente come
   * prima del Load fallito (nessuna riga da rimuovere/adattare qui per il
   * caso di errore, il chiamante Topbar.onLoad continua a mostrarlo com'è).
   */
  function loadScene(data: SceneData): void {
    const newRoots = loadSceneReplacingCurrent(data, scene, roots);
    roots = newRoots;
    rootObject3Ds = newRoots.map((go) => go._object3D);
    sceneRootsStore.set(newRoots);
    // Il GameObject selezionato prima del load non esiste più: le
    // subscription già registrate su selectionStore (updateGizmoTarget/
    // updateHighlight, sopra) reagiscono da sole, nessun'altra chiamata
    // esplicita necessaria qui.
    selectionStore.set(null);
    // Fase 6B.client-2: a differenza di selectionStore, un editingByStore
    // invariato NON ritrigghera da solo updateLockVisuals dopo un Load —
    // ma i vecchi GameObject a cui un eventuale lock attivo puntava sono
    // stati appena distrutti da loadSceneReplacingCurrent sopra. Ricalcolo
    // esplicito: ririsolve ogni lock ancora attivo contro i NUOVI roots
    // (stesso gameObjectId, nuova istanza, se la scena caricata lo
    // contiene ancora) o lo rimuove (se non più presente), invece di
    // lasciare box/etichette a puntare a Object3D ormai disposti.
    updateLockVisuals();
    // Fase 7 — fire-and-forget deliberato: `loadScene` resta sincrona nella
    // sua firma pubblica (Topbar.tsx la chiama senza await, vedi JSDoc
    // sull'interfaccia sopra), la ricostruzione visiva dei modelli
    // importati arriva un momento dopo via `rehydrateImportedModels`.
    void rehydrateImportedModels(newRoots);
  }

  /**
   * Fase 6C.1 — vedi JSDoc su `EditorSceneHandle.addGameObject`. `roots =
   * [...roots, go]` (nuovo array, non `.push()` in place) segue lo stesso
   * stile immutabile già usato da `loadScene` sopra per `roots`/
   * `rootObject3Ds`/`sceneRootsStore` — necessario perché
   * `createExternalStore.set` (editorStore.ts) confronta con `Object.is` per
   * decidere se notificare i sottoscrittori (Hierarchy.tsx in questo caso).
   */
  function addGameObject(
    kind: "empty" | "box" | "sphere" | "plane",
    name?: string,
    options?: { id?: string; transform?: TransformData; select?: boolean; broadcast?: boolean },
  ): GameObject {
    const { id, transform, select = true, broadcast = true } = options ?? {};
    const go = new GameObject(name ?? defaultNameForKind(kind), id);
    if (kind !== "empty") {
      const renderer = go.addComponent(MeshRenderer);
      renderer.shape = shapeForKind(kind);
    }
    if (transform) {
      applyTransformData(go, transform);
    }
    scene.add(go._object3D);
    roots = [...roots, go];
    rootObject3Ds = roots.map((r) => r._object3D);
    sceneRootsStore.set(roots);
    if (select) {
      selectionStore.set(go);
    }
    if (broadcast) {
      sendAddGameObject(go.id, kind, go.name, serializeTransform(go), serializeComponentsOf(go));
    }
    return go;
  }

  /**
   * Fase 6C.1 — vedi JSDoc su `EditorSceneHandle.removeGameObject`.
   * `Array.prototype.filter` restituisce SEMPRE un nuovo array (anche
   * quando nessun elemento viene scartato, es. `gameObject` non è un root
   * ma un figlio annidato di uno di essi — caso possibile con una scena
   * caricata da Save/Load, che supporta `children`): il nuovo riferimento
   * basta da solo a far ridisegnare Hierarchy via `sceneRootsStore.set`,
   * nessun trucco aggiuntivo di "forza un nuovo array" necessario oltre a
   * questo — verificato leggendo `Array.prototype.filter` (comportamento
   * standard ECMAScript, non specifico di questo progetto).
   */
  function removeGameObject(gameObject: GameObject, options?: { broadcast?: boolean }): void {
    const { broadcast = true } = options ?? {};
    const id = gameObject.id; // letto PRIMA di Destroy(), serve per il messaggio dopo
    Destroy(gameObject);
    roots = roots.filter((r) => r !== gameObject);
    rootObject3Ds = roots.map((r) => r._object3D);
    sceneRootsStore.set(roots);
    if (selectionStore.get() === gameObject) {
      selectionStore.set(null);
    }
    if (broadcast) {
      sendRemoveGameObject(id);
    }
  }

  /**
   * Fase 6D — vedi JSDoc su `EditorSceneHandle.addComponent`.
   * `bumpTransformVersion()` (nome storico, vedi editorStore.ts): riusato
   * qui come segnale generico "il GameObject selezionato è cambiato,
   * ridisegna l'Inspector" — esattamente lo stesso scopo per cui esiste
   * già (Position/Rotation/Scale), solo applicato a un componente invece
   * che al Transform. Necessario sia per il click locale su "Aggiungi
   * componente" sia per un componente arrivato da un ALTRO client
   * (collabClient.ts chiama questa stessa funzione con broadcast:false).
   */
  function addComponent(gameObject: GameObject, data: ComponentData, options?: { broadcast?: boolean }): Component {
    const { broadcast = true } = options ?? {};
    applyComponentData(gameObject, data);
    if (broadcast) {
      sendAddComponent(gameObject.id, data);
    }
    bumpTransformVersion();
    // Non può essere null: applyComponentData sopra lo ha appena creato
    // (o ha lanciato, se il tipo esisteva già — vedi JSDoc dell'interfaccia).
    return findComponentByType(gameObject, data.type)!;
  }

  /** Fase 6D — vedi JSDoc su `EditorSceneHandle.removeComponent`. */
  function removeComponent(gameObject: GameObject, type: ComponentTypeName, options?: { broadcast?: boolean }): void {
    const { broadcast = true } = options ?? {};
    const component = findComponentByType(gameObject, type);
    if (!component) return;
    gameObject.removeComponent(component);
    if (broadcast) {
      sendRemoveComponent(gameObject.id, type);
    }
    bumpTransformVersion();
  }

  /** Fase 6D — vedi JSDoc su `EditorSceneHandle.updateComponent`. */
  function updateComponent(gameObject: GameObject, data: ComponentData, options?: { broadcast?: boolean }): void {
    const { broadcast = true } = options ?? {};
    const component = findComponentByType(gameObject, data.type);
    if (!component) return;
    updateComponentData(component, data);
    if (broadcast) {
      sendUpdateComponent(gameObject.id, data);
    }
    bumpTransformVersion();
  }

  /**
   * Fase 7 — vedi JSDoc su `EditorSceneHandle.addImportedModel`. Crea il
   * GameObject "contenitore" PRIMA di risolvere l'object URL: se
   * `getAssetObjectURL`/`attachGLTF` dovessero fallire (asset rimosso nel
   * frattempo, file GLTF malformato), l'oggetto resta comunque nella
   * scena/Hierarchy — vuoto visivamente ma selezionabile/spostabile,
   * invece di sparire silenziosamente o lasciare la Promise rigettata non
   * gestita. Lo stesso compromesso di tolleranza già descritto in
   * `getAssetObjectURL` (assets/assetsController.ts) per un asset
   * mancante durante un Load.
   */
  async function addImportedModel(assetId: string, name: string): Promise<GameObject> {
    const go = new GameObject(name);
    go.sourceAssetId = assetId;
    scene.add(go._object3D);
    roots = [...roots, go];
    rootObject3Ds = roots.map((r) => r._object3D);
    sceneRootsStore.set(roots);
    selectionStore.set(go);

    const url = await getAssetObjectURL(assetId);
    if (url) {
      try {
        await attachGLTF(go, url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return go;
  }

  /**
   * Fase 7 — dopo un `loadScene`, ogni GameObject deserializzato con
   * `sourceAssetId` ha già id/transform corretti (ricostruiti in modo
   * sincrono da `deserializeScene`, vedi SceneSerializer.ts) ma NESSUNA
   * gerarchia three.js visibile: il formato SceneData non la serializza
   * (vedi il commento su `GameObjectData.sourceAssetId` in @engine/core).
   * Questa funzione la riattacca in modo asincrono, GameObject per
   * GameObject, senza bloccare il resto del load (che resta sincrono,
   * vedi `loadScene` sotto: chiamata con `void`, non `await`ata dal
   * chiamante). Un asset non più presente in IndexedDB (rimosso dal
   * pannello Assets dopo il Save) lascia semplicemente quel GameObject
   * senza mesh, stessa tolleranza di `addImportedModel` sopra.
   */
  async function rehydrateImportedModels(newRoots: readonly GameObject[]): Promise<void> {
    for (const go of flattenGameObjects(newRoots)) {
      if (!go.sourceAssetId) continue;
      const url = await getAssetObjectURL(go.sourceAssetId);
      if (!url) continue;
      try {
        await attachGLTF(go, url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  function setSize(newWidth: number, newHeight: number): void {
    if (newWidth <= 0 || newHeight <= 0) return;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // updateStyle=false: il canvas è dimensionato via CSS dal pannello
    // (width/height: 100%), non vogliamo che three.js sovrascriva lo
    // style inline con px assoluti ad ogni resize.
    renderer.setSize(newWidth, newHeight, false);
    // CSS2DRenderer.setSize (Fase 6B.client-2) non tocca lo style del
    // proprio domElement in modo incompatibile come renderer.setSize
    // sopra: aggiorna solo le dimensioni interne usate per proiettare le
    // coordinate 3D→schermo, il posizionamento (`.viewport-labels` in
    // App.css) resta CSS puro (position:absolute; inset:0).
    labelRenderer.setSize(newWidth, newHeight);
  }

  function dispose(): void {
    engine.stop();
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    unsubscribeSelection();
    unsubscribeGizmoTarget();
    unsubscribeGizmoLock();
    unsubscribeEditingByVisuals();
    unsubscribePresenceVisuals();
    // Rimuove ogni highlight+etichetta di lock ancora attivo (Fase
    // 6B.client-2) — stesso motivo di highlightHelper sotto: senza questa
    // pulizia un rimontaggio del Viewport (HMR/StrictMode) lascerebbe
    // BoxHelper/CSS2DObject orfani agganciati a GameObject già distrutti
    // da Engine._resetAll() più sotto.
    for (const gameObjectId of Array.from(lockVisuals.keys())) {
      removeLockVisual(gameObjectId);
    }
    labelRenderer.domElement.remove();
    // detach() prima di dispose(): evita che TransformControls tenti di
    // continuare a leggere l'Object3D agganciato durante il proprio
    // teardown. controls.dispose() (ereditato dalla classe base astratta
    // `Controls` di three.js, non specifico di TransformControls) scollega
    // i listener DOM registrati dal costruttore; getHelper().dispose() è una
    // chiamata distinta e necessaria a parte: libera le geometrie/materiali
    // del gizmo visivo (TransformControlsRoot), non toccati da
    // controls.dispose() (verificato leggendo TransformControls.js: sono
    // due metodi separati con responsabilità distinte, non uno alias
    // dell'altro).
    transformControls.detach();
    transformControls.dispose();
    gizmoHelper.dispose();
    scene.remove(gizmoHelper);
    if (highlightHelper) {
      scene.remove(highlightHelper);
      highlightHelper.dispose();
      highlightHelper = null;
    }
    cameraController.dispose();
    renderer.domElement.remove();
    renderer.dispose();
    // Scene.ts (packages/core) tiene un registry dei GameObject vivi a
    // livello di MODULO, non scoped per istanza: senza questo reset, uno
    // smontaggio/rimontaggio del pannello (HMR, o il doppio invoke degli
    // effect in React StrictMode) farebbe accumulare GameObject "fantasma"
    // della scena precedente nel game loop successivo.
    Engine._resetAll();
    // Fase 5C.3 — stesso identico rischio di Engine._resetAll() sopra, ma per
    // il World di Rapier: Physics.ts è un modulo a stato di modulo esattamente
    // come Scene.ts, e da quando questa fase collega initPhysics()/Physics.step
    // (vedi sopra), un remount del Viewport senza questa chiamata libererebbe
    // un NUOVO RAPIER.World ad ogni bootstrap senza mai `.free()`are quello
    // precedente (vedi il commento su _resetPhysics in Physics.ts).
    _resetPhysics();
  }

  return {
    engine,
    scene,
    camera,
    roots,
    loadScene,
    addGameObject,
    removeGameObject,
    addComponent,
    removeComponent,
    updateComponent,
    addImportedModel,
    setSize,
    dispose,
  };
}
