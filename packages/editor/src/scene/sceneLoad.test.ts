import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  Engine,
  GameObject,
  Destroy,
  MeshRenderer,
  RigidBody,
  BoxCollider,
  serializeScene,
  initPhysics,
  raycast,
  Physics,
  _resetPhysics,
} from "@engine/core";
import type { SceneData, ComponentData } from "@engine/core";
import { clearGameObjects, loadSceneData, loadSceneReplacingCurrent } from "./sceneLoad.js";

const FIXED_DT = 1 / 60;

describe("sceneLoad", () => {
  beforeEach(() => {
    Engine._resetAll();
  });

  it("clearGameObjects rimuove i root dalla scena three.js", () => {
    const scene = new THREE.Scene();
    const go = new GameObject("Cube");
    scene.add(go._object3D);
    expect(scene.children).toContain(go._object3D);

    clearGameObjects([go], scene);

    expect(scene.children).not.toContain(go._object3D);
  });

  it("clearGameObjects distrugge anche i GameObject figli, non solo i root", () => {
    const scene = new THREE.Scene();
    const parent = new GameObject("Parent");
    const child = new GameObject("Child");
    child.transform.setParent(parent.transform);
    scene.add(parent._object3D);

    clearGameObjects([parent], scene);

    // Destroy() rimanda la rimozione dal registry a fine frame (stesso
    // meccanismo già testato altrove nel core): qui verifichiamo che
    // entrambi siano stati marcati per la distruzione, root e figlio.
    expect(parent._destroyed).toBe(true);
    expect(child._destroyed).toBe(true);
  });

  it("clearGameObjects rilascia geometria/materiale di MeshRenderer (via onDestroy)", () => {
    const scene = new THREE.Scene();
    const go = new GameObject("Cube");
    go.addComponent(MeshRenderer);
    scene.add(go._object3D);
    expect(go._object3D.children.length).toBeGreaterThan(0); // la Mesh esiste prima della pulizia

    clearGameObjects([go], scene);
    // Destroy() (chiamato da clearGameObjects) rimanda onDestroy() al flush
    // di fine-frame di Engine, non lo esegue sincrono — stesso comportamento
    // già testato altrove nel core: bisogna far girare un frame perché
    // MeshRenderer.onDestroy() rimuova davvero la Mesh e disponga le risorse.
    new Engine().step(0);

    expect(go._object3D.children.length).toBe(0);
  });

  it("loadSceneData ricostruisce i root e li aggiunge alla scena", () => {
    const scene = new THREE.Scene();
    const original = new GameObject("Cube");
    original.transform.setPosition(1, 2, 3);
    const data: SceneData = serializeScene([original]);

    const newRoots = loadSceneData(data, scene);

    expect(newRoots).toHaveLength(1);
    expect(scene.children).toContain(newRoots[0]!._object3D);
    expect(newRoots[0]!.transform.position.x).toBeCloseTo(1);
  });

  it("clearGameObjects poi loadSceneData: la scena finale contiene solo i nuovi root", () => {
    const scene = new THREE.Scene();
    const oldGO = new GameObject("Vecchio");
    scene.add(oldGO._object3D);
    const data = serializeScene([new GameObject("Nuovo")]);

    clearGameObjects([oldGO], scene);
    const newRoots = loadSceneData(data, scene);

    expect(scene.children).not.toContain(oldGO._object3D);
    expect(scene.children).toContain(newRoots[0]!._object3D);
    expect(newRoots[0]!.name).toBe("Nuovo");
  });
});

/**
 * sceneLoad — round-trip RigidBody/Collider lungo il path editor reale
 * (Fase 5C.2). Il round-trip di questi componenti era testato finora SOLO in
 * SceneSerializer.test.ts (packages/core), che serializza/deserializza
 * direttamente in Node senza mai passare da `loadSceneData`/`clearGameObjects`
 * né da un Engine con `Physics.step` realmente collegato come onFixedStep
 * (vedi createEditorScene.ts, Fase 5C.1) — gap ora significativo perché nel
 * frattempo 5C.1 ha reso la fisica dell'editor realmente attiva.
 *
 * Describe block separato (non innestato nel blocco `sceneLoad` sopra) con un
 * proprio `beforeEach` che resetta anche il modulo Physics, stesso stile dei
 * blocchi in Physics.test.ts — necessario per isolamento: `_resetPhysics()`
 * non viene mai chiamato da `Engine._resetAll()` (Engine resta deliberatamente
 * ignaro del modulo Physics, vedi il commento in Engine.ts/Physics.ts).
 */
describe("sceneLoad — round-trip RigidBody/Collider (Fase 5C.2)", () => {
  beforeEach(() => {
    Engine._resetAll();
    _resetPhysics();
  });

  it("loadSceneData con RigidBody/Collider non lancia se initPhysics() non è mai stata chiamata (awake() registra soltanto, nessuna _getWorld())", () => {
    const scene = new THREE.Scene();
    const original = new GameObject("Cubo-fisico");
    original.addComponent(RigidBody);
    original.addComponent(BoxCollider);
    const data: SceneData = serializeScene([original]);

    expect(() => loadSceneData(data, scene)).not.toThrow();
  });

  it("il Collider caricato tramite loadSceneData viene realizzato e colpito da un raycast dopo un tick fisico", async () => {
    await initPhysics();
    const scene = new THREE.Scene();
    const original = new GameObject("Suolo");
    original.transform.setPosition(0, 0, 0);
    original.addComponent(BoxCollider).size = { x: 20, y: 0.4, z: 20 };
    const data: SceneData = serializeScene([original]);
    // `original` è solo scaffolding per produrre `data` (mai aggiunto a `scene`,
    // mai parte della scena viva) — va distrutto subito, altrimenti il suo
    // BoxCollider resta registrato in Physics e verrebbe realizzato ANCH'ESSO
    // dal prossimo tick fisico, in parallelo a quello caricato da loadSceneData.
    Destroy(original);

    loadSceneData(data, scene);

    // Stesso pattern di Physics.test.ts per avanzare deterministicamente senza
    // rAF, ma qui passando da un Engine con Physics.step wired come
    // onFixedStep (Fase 5C.1) invece del solo `step()` grezzo — è il path
    // editor reale a dover essere verificato, non solo il modulo Physics preso
    // isolatamente (già coperto da Physics.test.ts).
    const engine = new Engine(undefined, Physics.step);
    engine.step(FIXED_DT); // realizza il Collider pending (Physics._realizePending)

    const hit = raycast(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0), 100);
    expect(hit).not.toBeNull();
  });

  it("un secondo Load rimuove il vecchio Collider dal World: un raycast alla vecchia posizione torna null dopo il flush dei Destroy", async () => {
    await initPhysics();
    const scene = new THREE.Scene();

    const oldGO = new GameObject("Vecchio-suolo");
    oldGO.transform.setPosition(0, 0, 0);
    oldGO.addComponent(BoxCollider).size = { x: 20, y: 0.4, z: 20 };
    const oldData = serializeScene([oldGO]);
    // Stesso motivo del test precedente: `oldGO`/`newGO` sotto sono solo
    // scaffolding per produrre i dati serializzati, non parte della scena
    // viva — distruggerli súbito evita che i loro BoxCollider restino
    // registrati in Physics e vengano realizzati in parallelo a quelli
    // caricati, il che falserebbe il raycast alla "vecchia posizione" più sotto.
    Destroy(oldGO);
    const oldRoots = loadSceneData(oldData, scene);

    const engine = new Engine(undefined, Physics.step);
    engine.step(FIXED_DT); // flush di oldGO (scaffolding) + realizza il Collider caricato

    // Sanity check: il vecchio Collider è davvero lì prima del secondo Load.
    expect(raycast(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0), 100)).not.toBeNull();

    const newGO = new GameObject("Nuovo-suolo");
    newGO.transform.setPosition(100, 0, 0); // posizione diversa: nessuna ambiguità fra i due raycast
    newGO.addComponent(BoxCollider).size = { x: 20, y: 0.4, z: 20 };
    const newData = serializeScene([newGO]);
    Destroy(newGO);

    clearGameObjects(oldRoots, scene);
    loadSceneData(newData, scene);

    // Un solo tick: Physics.step (onFixedStep) realizza il nuovo Collider
    // pending, poi il flush dei Destroy di fine-frame chiama Collider.onDestroy()
    // sia sul vecchio Collider caricato (world.removeCollider) sia su quello di
    // newGO/scaffolding (mai realizzato, quindi no-op) — nessun fantasma Rapier
    // rimasto.
    engine.step(FIXED_DT);

    expect(raycast(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0), 100)).toBeNull();
  });
});

/**
 * sceneLoad — loadSceneReplacingCurrent (Fase 5C.4). A differenza del blocco
 * sopra (dove clear+load sono chiamati in sequenza dal test stesso, ordine
 * clear-poi-load), qui si verifica la funzione che l'editor usa realmente
 * (createEditorScene.ts, EditorSceneHandle.loadScene): costruisce prima,
 * distrugge poi — solo a costruzione riuscita.
 */
describe("sceneLoad — loadSceneReplacingCurrent (Fase 5C.4)", () => {
  beforeEach(() => {
    Engine._resetAll();
  });

  it("un dato nuovo corrotto non tocca la scena corrente: il vecchio root resta intatto, non distrutto", () => {
    const scene = new THREE.Scene();
    const vecchio = new GameObject("Vecchio");
    scene.add(vecchio._object3D);

    const datiCorrotti = serializeScene([new GameObject("Scaffolding")]);
    datiCorrotti.roots[0]!.components.push({ type: "TipoInesistente" } as unknown as ComponentData);

    expect(() => loadSceneReplacingCurrent(datiCorrotti, scene, [vecchio])).toThrow(
      /ComponentData\.type non gestito/
    );

    // deserializeScene ha già ripulito (Fase 5C.4, vedi SceneSerializer.ts) i
    // fantasmi che aveva creato prima di lanciare; qui verifichiamo l'altra
    // metà della garanzia: clearGameObjects non è MAI stato chiamato, quindi
    // il vecchio root è ancora nella scena three.js e non marcato per la
    // distruzione.
    expect(scene.children).toContain(vecchio._object3D);
    expect(vecchio._destroyed).toBe(false);
  });

  it("a successo, sostituisce la scena corrente: il vecchio root viene distrutto e i nuovi aggiunti", () => {
    const scene = new THREE.Scene();
    const vecchio = new GameObject("Vecchio");
    scene.add(vecchio._object3D);

    const data = serializeScene([new GameObject("Nuovo")]);

    const newRoots = loadSceneReplacingCurrent(data, scene, [vecchio]);

    expect(scene.children).toContain(newRoots[0]!._object3D);
    expect(scene.children).not.toContain(vecchio._object3D);
    expect(vecchio._destroyed).toBe(true);
  });
});
