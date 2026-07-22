import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { Engine, GameObject, MeshRenderer, serializeScene } from "@engine/core";
import type { SceneData } from "@engine/core";
import { clearGameObjects, loadSceneData } from "./sceneLoad.js";

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
