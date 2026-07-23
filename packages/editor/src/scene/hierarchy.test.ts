import { describe, it, expect } from "vitest";
import { buildHierarchy, findOwningGameObject, flattenGameObjects } from "./hierarchy.js";
import type { GameObject } from "@engine/core";
import type * as THREE from "three";

/**
 * Fake minimali di Object3D/GameObject per testare l'algoritmo di
 * hierarchy.ts in isolamento: bastano le forme `.children`/`.userData`/
 * `.parent` che l'algoritmo legge davvero, non serve three.js/@engine/core
 * a runtime. Questo evita anche che questi test dipendano dal build di
 * @engine/core (che potrebbe non essere ancora avvenuto se qualcuno gira
 * `pnpm test` fuori dall'ordine Lint→Build→Typecheck→Test della CI).
 */
interface FakeObject3D {
  children: FakeObject3D[];
  parent: FakeObject3D | null;
  userData: Record<string, unknown>;
}

function makeObject3D(): FakeObject3D {
  return { children: [], parent: null, userData: {} };
}

function makeGameObject(name: string, object3D: FakeObject3D): GameObject {
  const fakeGameObject = { name, _object3D: object3D } as unknown as GameObject;
  object3D.userData["__gameObject"] = fakeGameObject;
  return fakeGameObject;
}

function attach(parent: FakeObject3D, child: FakeObject3D): void {
  child.parent = parent;
  parent.children.push(child);
}

describe("buildHierarchy", () => {
  it("un GameObject radice senza figli produce un nodo senza children", () => {
    const groundObject3D = makeObject3D();
    const ground = makeGameObject("Ground", groundObject3D);

    const tree = buildHierarchy([ground]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.gameObject).toBe(ground);
    expect(tree[0]?.children).toEqual([]);
  });

  it("un Object3D 'nudo' (es. una Mesh) non genera una riga ma non blocca la ricorsione", () => {
    const cubeObject3D = makeObject3D();
    const cube = makeGameObject("Cube", cubeObject3D);
    const meshObject3D = makeObject3D(); // niente userData["__gameObject"]: è una Mesh, non un GameObject
    attach(cubeObject3D, meshObject3D);

    const tree = buildHierarchy([cube]);

    expect(tree[0]?.children).toEqual([]);
  });

  it("attraversa un Object3D nudo per trovare GameObject annidati più in profondità", () => {
    const parentObject3D = makeObject3D();
    const parent = makeGameObject("Parent", parentObject3D);
    const nudeObject3D = makeObject3D();
    attach(parentObject3D, nudeObject3D);
    const childObject3D = makeObject3D();
    const child = makeGameObject("Child", childObject3D);
    attach(nudeObject3D, childObject3D);

    const tree = buildHierarchy([parent]);

    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.gameObject).toBe(child);
  });

  it("costruisce una vera gerarchia multi-livello via Transform.setParent (Object3D.add)", () => {
    const propsObject3D = makeObject3D();
    const props = makeGameObject("Props", propsObject3D);
    const cubeObject3D = makeObject3D();
    const cube = makeGameObject("Cube", cubeObject3D);
    attach(propsObject3D, cubeObject3D);

    const tree = buildHierarchy([props]);

    expect(tree[0]?.gameObject).toBe(props);
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.gameObject).toBe(cube);
    expect(tree[0]?.children[0]?.children).toEqual([]);
  });

  it("più radici indipendenti restano radici separate (scena demo piatta)", () => {
    const ground = makeGameObject("Ground", makeObject3D());
    const cube = makeGameObject("Cube", makeObject3D());
    const sphere = makeGameObject("Sphere", makeObject3D());

    const tree = buildHierarchy([ground, cube, sphere]);

    expect(tree.map((node) => node.gameObject.name)).toEqual(["Ground", "Cube", "Sphere"]);
  });
});

describe("flattenGameObjects", () => {
  it("appiattisce più radici indipendenti nell'ordine pre-order (scena demo piatta)", () => {
    const ground = makeGameObject("Ground", makeObject3D());
    const cube = makeGameObject("Cube", makeObject3D());
    const sphere = makeGameObject("Sphere", makeObject3D());

    expect(flattenGameObjects([ground, cube, sphere])).toEqual([ground, cube, sphere]);
  });

  it("appiattisce una gerarchia multi-livello in ordine pre-order (genitore prima dei figli)", () => {
    const propsObject3D = makeObject3D();
    const props = makeGameObject("Props", propsObject3D);
    const cubeObject3D = makeObject3D();
    const cube = makeGameObject("Cube", cubeObject3D);
    attach(propsObject3D, cubeObject3D);

    expect(flattenGameObjects([props])).toEqual([props, cube]);
  });

  it("salta gli Object3D 'nudi' (es. una Mesh) ma include i GameObject annidati più in profondità", () => {
    const parentObject3D = makeObject3D();
    const parent = makeGameObject("Parent", parentObject3D);
    const nudeObject3D = makeObject3D();
    attach(parentObject3D, nudeObject3D);
    const childObject3D = makeObject3D();
    const child = makeGameObject("Child", childObject3D);
    attach(nudeObject3D, childObject3D);

    expect(flattenGameObjects([parent])).toEqual([parent, child]);
  });

  it("restituisce un array vuoto per una lista di radici vuota", () => {
    expect(flattenGameObjects([])).toEqual([]);
  });
});

describe("findOwningGameObject", () => {
  it("trova il GameObject quando l'Object3D è esso stesso il proprietario", () => {
    const object3D = makeObject3D();
    const gameObject = makeGameObject("Solo", object3D);

    expect(findOwningGameObject(object3D as unknown as THREE.Object3D)).toBe(gameObject);
  });

  it("risale la catena parent per trovare il GameObject a partire da una Mesh figlia", () => {
    const cubeObject3D = makeObject3D();
    const cube = makeGameObject("Cube", cubeObject3D);
    const meshObject3D = makeObject3D();
    attach(cubeObject3D, meshObject3D);

    expect(findOwningGameObject(meshObject3D as unknown as THREE.Object3D)).toBe(cube);
  });

  it("restituisce null se nessun antenato appartiene a un GameObject", () => {
    const orphanObject3D = makeObject3D();

    expect(findOwningGameObject(orphanObject3D as unknown as THREE.Object3D)).toBeNull();
  });

  it("restituisce null se l'Object3D di partenza è null", () => {
    expect(findOwningGameObject(null)).toBeNull();
  });
});
