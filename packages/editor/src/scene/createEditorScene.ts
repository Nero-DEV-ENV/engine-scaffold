import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  Engine,
  GameObject,
  MeshRenderer,
  createRenderer,
  createBasicLighting,
  OrbitCameraController,
} from "@engine/core";
import { findOwningGameObject } from "./hierarchy.js";
import { selectionStore, bumpTransformVersion } from "../store/editorStore.js";

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
  /** GameObject radice della scena, nell'ordine da mostrare in Hierarchy (vedi scene/hierarchy.ts). */
  readonly roots: readonly GameObject[];
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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d21);

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  camera.position.set(4, 3, 6);

  const cameraController = new OrbitCameraController(camera, renderer.domElement);
  cameraController.setTarget(0, 0.5, 0);

  const lighting = createBasicLighting();
  scene.add(lighting.ambient._object3D, lighting.keyLight._object3D);

  // Ground/Cube/Sphere usano MeshRenderer (Fase 5) invece di una THREE.Mesh
  // costruita a mano: la rappresentazione visiva (forma/colore) diventa così
  // un dato leggibile da SceneSerializer, non più codice imperativo qui —
  // condizione necessaria perché la scena sopravviva a un ciclo save/load
  // (deliverable di questa fase). MeshRenderer.shape "plane" è già
  // orizzontale di default (vedi MeshRenderer.ts), quindi la rotazione
  // correttiva che prima veniva applicata qui a mano non serve più.
  const groundGO = new GameObject("Ground");
  const groundRenderer = groundGO.addComponent(MeshRenderer);
  groundRenderer.shape = { kind: "plane", width: 10, height: 10 };
  groundRenderer.color = 0x2f3237;
  scene.add(groundGO._object3D);

  const cubeGO = new GameObject("Cube");
  cubeGO.transform.setPosition(-1, 0.5, 0);
  const cubeRenderer = cubeGO.addComponent(MeshRenderer);
  cubeRenderer.shape = { kind: "box", size: { x: 1, y: 1, z: 1 } };
  cubeRenderer.color = 0x4f8ef7;
  scene.add(cubeGO._object3D);

  const sphereGO = new GameObject("Sphere");
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
  const roots: readonly GameObject[] = [groundGO, cubeGO, sphereGO, lighting.ambient, lighting.keyLight];

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
  function updateGizmoTarget(selected: GameObject | null): void {
    if (selected) {
      transformControls.attach(selected._object3D);
    } else {
      transformControls.detach();
    }
  }

  updateGizmoTarget(selectionStore.get());
  const unsubscribeGizmoTarget = selectionStore.subscribe(() => {
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
  transformControls.addEventListener("dragging-changed", (event) => {
    cameraController.enabled = !(event.value as boolean);
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
  const rootObject3Ds = roots.map((go) => go._object3D);
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

  const engine = new Engine((dt) => {
    cameraController.update(dt);
    // Ricalcola il box dell'highlight ad ogni frame, non solo al cambio
    // selezione: ora che il gizmo (Fase 4C) può spostare l'oggetto
    // selezionato mentre resta selezionato, il box degenererebbe (resterebbe
    // fermo alla posizione di quando è stato creato) senza questo update
    // per-frame.
    highlightHelper?.update();
    renderer.render(scene, camera);
  });
  engine.start();

  function setSize(newWidth: number, newHeight: number): void {
    if (newWidth <= 0 || newHeight <= 0) return;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // updateStyle=false: il canvas è dimensionato via CSS dal pannello
    // (width/height: 100%), non vogliamo che three.js sovrascriva lo
    // style inline con px assoluti ad ogni resize.
    renderer.setSize(newWidth, newHeight, false);
  }

  function dispose(): void {
    engine.stop();
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    unsubscribeSelection();
    unsubscribeGizmoTarget();
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
  }

  return { engine, scene, camera, roots, setSize, dispose };
}
