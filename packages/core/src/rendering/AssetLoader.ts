import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GameObject } from "../core/GameObject.js";

export interface LoadedModel {
  /** GameObject "contenitore": la sua Transform è libera (posiziona/ruota/scala l'intero modello), l'intera gerarchia GLTF è appesa come figlio del suo Object3D. */
  gameObject: GameObject;
  /** Clip di animazione incluse nel file, se presenti (non riprodotte automaticamente — serviranno un AnimationMixer in una fase successiva). */
  animations: THREE.AnimationClip[];
  /** Risultato grezzo di GLTFLoader, per chi ha bisogno di accedere a cameras/scenes/parser direttamente. */
  gltf: GLTF;
}

/** Loader GLTFLoader condiviso: instanziarlo una sola volta evita di ricostruire il parser DRACO/KTX2 ad ogni load. */
let sharedLoader: GLTFLoader | null = null;

function getSharedLoader(): GLTFLoader {
  if (!sharedLoader) {
    sharedLoader = new GLTFLoader();
  }
  return sharedLoader;
}

/**
 * loadGLTF — carica un asset .gltf/.glb e lo avvolge in un GameObject,
 * pronto per essere aggiunto alla scena three.js con
 * `scene.add(model.gameObject._object3D)`.
 *
 * I materiali arrivano già PBR (MeshStandardMaterial/MeshPhysicalMaterial)
 * perché è il comportamento di default di GLTFLoader — non serve alcuna
 * conversione aggiuntiva lato motore.
 *
 * Nota: GLTFLoader (addon three.js) importa la sua copia di "three" dal
 * bare specifier "three", non da "three/webgpu" — vedi il commento
 * architetturale in Renderer.ts sul perché questo non è un problema per
 * `scene.add()`/`renderer.render()`.
 */
export function loadGLTF(url: string, name?: string): Promise<LoadedModel> {
  return new Promise((resolve, reject) => {
    getSharedLoader().load(
      url,
      (gltf) => {
        const gameObject = new GameObject(name ?? deriveNameFromUrl(url));
        gameObject._object3D.add(gltf.scene);
        resolve({ gameObject, animations: gltf.animations, gltf });
      },
      undefined,
      (error) => {
        reject(new Error(`loadGLTF: impossibile caricare "${url}": ${String(error)}`));
      }
    );
  });
}

function deriveNameFromUrl(url: string): string {
  const fileName = url.split("/").pop() ?? url;
  return fileName.replace(/\.(gltf|glb)$/i, "") || "Model";
}
