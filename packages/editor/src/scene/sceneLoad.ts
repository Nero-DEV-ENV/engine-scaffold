import type * as THREE from "three";
import { Destroy, deserializeScene } from "@engine/core";
import type { GameObject, SceneData } from "@engine/core";
import { buildHierarchy, type HierarchyNode } from "./hierarchy.js";

/**
 * sceneLoad.ts — pulizia della scena corrente e ricostruzione da
 * `SceneData` (Fase 5B.2, l'equivalente di `SceneManager.LoadScene` in
 * Unity: scarica la scena corrente e ne carica una nuova al suo posto).
 *
 * Estratto da `createEditorScene.ts` perché, a differenza del resto del
 * bootstrap (WebGPU/DOM), questa logica non tocca alcuna API browser —
 * `GameObject`/`Destroy`/`THREE.Scene` girano già in Node/Vitest (vedi
 * `SceneSerializer.test.ts`) — quindi è testabile in automatico qui invece
 * di restare verificabile solo con uno smoke-test manuale.
 */

function destroyNodeRecursive(node: HierarchyNode): void {
  for (const child of node.children) destroyNodeRecursive(child);
  Destroy(node.gameObject);
}

/**
 * Rimuove `roots` dalla scena three.js (immediato: nessun frame di overlap
 * visivo con la scena nuova, a differenza di affidarsi al solo flush di
 * fine-frame di `Destroy`) e distrugge ogni GameObject attualmente vivo
 * sotto `roots`, discendenti inclusi — non solo i roots stessi.
 *
 * Necessario camminare l'intero sottoalbero (via `buildHierarchy`, stesso
 * modulo usato da Hierarchy.tsx): altrimenti i GameObject figli
 * resterebbero nel registry globale di `Scene.ts` fra un load e l'altro
 * (ancora "vivi", iterati da `update()`/`fixedUpdate()` pur essendo
 * scollegati dalla scena) e le loro `Mesh` (`MeshRenderer`) non
 * rilascerebbero mai geometria/materiale — `onDestroy()` è l'unico punto
 * che chiama `dispose()` su quelle risorse.
 */
export function clearGameObjects(roots: readonly GameObject[], scene: THREE.Scene): void {
  for (const root of roots) {
    scene.remove(root._object3D);
  }
  for (const node of buildHierarchy(roots)) {
    destroyNodeRecursive(node);
  }
}

/**
 * Deserializza `data` e aggiunge ogni root risultante a `scene` — stesso
 * pattern già usato da `createEditorScene.ts` per `Instantiate`: tocca al
 * chiamante fare `scene.add()`, non a `deserializeScene` stesso.
 */
export function loadSceneData(data: SceneData, scene: THREE.Scene): GameObject[] {
  const newRoots = deserializeScene(data);
  for (const root of newRoots) {
    scene.add(root._object3D);
  }
  return newRoots;
}
