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
 * loadGLTFRaw — carica un asset .gltf/.glb e restituisce il risultato
 * grezzo di GLTFLoader, senza avvolgerlo in alcun GameObject. Estratta da
 * `loadGLTF` in Fase 7 perché `attachGLTF` (sotto) ha bisogno esattamente
 * dello stesso caricamento ma su un GameObject GIÀ ESISTENTE invece che
 * crearne uno nuovo — un'unica funzione privata evita di duplicare la
 * gestione del loader condiviso/Promise/errori in due punti.
 */
function loadGLTFRaw(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    getSharedLoader().load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (error) => {
        reject(new Error(`loadGLTF: impossibile caricare "${url}": ${String(error)}`));
      }
    );
  });
}

/**
 * loadGLTF — carica un asset .gltf/.glb e lo avvolge in un NUOVO GameObject,
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
  return loadGLTFRaw(url).then((gltf) => {
    const gameObject = new GameObject(name ?? deriveNameFromUrl(url));
    gameObject._object3D.add(gltf.scene);
    return { gameObject, animations: gltf.animations, gltf };
  });
}

/**
 * attachGLTF — Fase 7: carica un asset .gltf/.glb e appende la sua
 * gerarchia a un GameObject GIÀ ESISTENTE, invece di crearne uno nuovo
 * (a differenza di `loadGLTF` sopra). Usata dall'editor per due percorsi
 * distinti che condividono lo stesso bisogno — "il contenitore esiste già,
 * serve solo attaccargli la mesh":
 * 1. Import di un asset dal pannello Assets su un GameObject appena creato
 *    (con id/nome propri già assegnati dall'editor).
 * 2. Ricostruzione al caricamento di una scena salvata: il GameObject
 *    "contenitore" arriva già da `deserializeScene` (con id/transform/
 *    sourceAssetId propri, vedi SceneSerializer.ts), qui viene solo
 *    riattaccata la gerarchia three.js che il formato SceneData non
 *    serializza.
 *
 * Non restituisce un `GameObject` (il chiamante ce l'ha già): solo
 * animazioni/gltf grezzo, per lo stesso motivo di `LoadedModel.animations`/
 * `LoadedModel.gltf` sopra.
 */
export function attachGLTF(
  gameObject: GameObject,
  url: string
): Promise<{ animations: THREE.AnimationClip[]; gltf: GLTF }> {
  return loadGLTFRaw(url).then((gltf) => {
    gameObject._object3D.add(gltf.scene);
    return { animations: gltf.animations, gltf };
  });
}

function deriveNameFromUrl(url: string): string {
  const fileName = url.split("/").pop() ?? url;
  return fileName.replace(/\.(gltf|glb)$/i, "") || "Model";
}
