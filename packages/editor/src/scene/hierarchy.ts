import type * as THREE from "three";
import type { GameObject } from "@engine/core";

/**
 * hierarchy.ts — costruzione dell'albero Hierarchy a partire dai
 * GameObject radice della scena e risalita Object3D→GameObject per la
 * selezione via raycast dal Viewport.
 *
 * @engine/core non espone (ancora) un'API di enumerazione della scene
 * graph: `Scene.ts` tiene `_getLiveGameObjects()` ma è `@internal`, non
 * riesportata da `index.ts` (verificato leggendo il file, non assunto).
 * Non serve aggiungere nulla al core per questa fase: `createEditorScene`
 * istanzia lui stesso i GameObject radice della scena demo, quindi può
 * tenerne traccia ed esporli come `EditorSceneHandle.roots` — questo
 * modulo si limita a camminare la sottogerarchia Object3D di ciascuna
 * radice (via `Transform.setParent`/`Object3D.add`, già three.js allo
 * stato nativo) per costruire l'albero da mostrare in Hierarchy.
 */

export interface HierarchyNode {
  readonly gameObject: GameObject;
  readonly children: readonly HierarchyNode[];
}

function collectGameObjectChildren(object3D: THREE.Object3D): HierarchyNode[] {
  const nodes: HierarchyNode[] = [];
  for (const child of object3D.children) {
    const childGameObject = child.userData["__gameObject"] as GameObject | undefined;
    if (childGameObject) {
      nodes.push({
        gameObject: childGameObject,
        children: collectGameObjectChildren(child),
      });
    } else {
      // Object3D "nudo" (es. una THREE.Mesh aggiunta direttamente al
      // proprio GameObject, non un GameObject essa stessa — vedi le mesh
      // di Ground/Cube/Sphere in createEditorScene.ts): non genera una
      // riga in Hierarchy, ma si attraversano comunque i suoi figli, per
      // non assumere che un GameObject annidato non possa mai comparire
      // sotto un Object3D non-GameObject (la scena demo attuale è piatta,
      // ma Transform.setParent regge già gerarchie vere).
      nodes.push(...collectGameObjectChildren(child));
    }
  }
  return nodes;
}

/** Costruisce l'albero Hierarchy a partire dai GameObject radice della scena. */
export function buildHierarchy(roots: readonly GameObject[]): HierarchyNode[] {
  return roots.map((gameObject) => ({
    gameObject,
    children: collectGameObjectChildren(gameObject._object3D),
  }));
}

/**
 * Risale da un Object3D three.js (tipicamente il risultato di un
 * raycast hit sul Viewport, che colpisce sempre la Mesh figlia, mai il
 * GameObject stesso) al GameObject proprietario più vicino, camminando
 * la catena `.parent` finché non trova `userData["__gameObject"]`.
 * Restituisce null se l'Object3D non appartiene a nessun GameObject
 * (non dovrebbe succedere per hit dentro le radici tracciate da
 * `EditorSceneHandle.roots`, ma l'API resta difensiva).
 */
export function findOwningGameObject(object3D: THREE.Object3D | null): GameObject | null {
  let current: THREE.Object3D | null = object3D;
  while (current) {
    const owner = current.userData["__gameObject"] as GameObject | undefined;
    if (owner) return owner;
    current = current.parent;
  }
  return null;
}
