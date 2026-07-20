import * as THREE from "three";
import { GameObject } from "../core/GameObject.js";

export interface BasicLightingOptions {
  /** Colore/intensità della luce ambientale (illuminazione di riempimento uniforme). Default: bianco, 0.6. */
  ambientColor?: THREE.ColorRepresentation;
  ambientIntensity?: number;
  /** Colore/intensità della key light direzionale. Default: bianco, 2.5 (le directional light in three.js "fisicamente corretto" richiedono intensità più alte delle vecchie unità). */
  keyLightColor?: THREE.ColorRepresentation;
  keyLightIntensity?: number;
  /** Posizione della key light (non ha bersaglio esplicito: punta sempre verso l'origine del suo target, di default (0,0,0)). */
  keyLightPosition?: [number, number, number];
}

export interface BasicLighting {
  /** GameObject che porta la AmbientLight come figlio del proprio Object3D. */
  ambient: GameObject;
  /** GameObject che porta la DirectionalLight (key light) come figlio del proprio Object3D. */
  keyLight: GameObject;
}

const DEFAULTS: Required<BasicLightingOptions> = {
  ambientColor: 0xffffff,
  ambientIntensity: 0.6,
  keyLightColor: 0xffffff,
  keyLightIntensity: 2.5,
  keyLightPosition: [3, 5, 2],
};

/**
 * createBasicLighting — illuminazione minima "seria" per una scena PBR:
 * una ambient light di riempimento più una directional key light. Non
 * sostituisce un vero environment/IBL (rimandato a una fase successiva
 * se servirà per i materiali PBR più riflettenti): per il deliverable
 * "illuminazione base" richiesto in Fase 2 è sufficiente e non introduce
 * la complessità/fragilità di PMREMGenerator con WebGPURenderer.
 *
 * Restituisce due GameObject (stesso pattern di Instantiate/Fase 1):
 * il chiamante li aggiunge alla THREE.Scene con
 * `scene.add(ambient._object3D, keyLight._object3D)`.
 */
export function createBasicLighting(options: BasicLightingOptions = {}): BasicLighting {
  const opts = { ...DEFAULTS, ...options };

  const ambient = new GameObject("AmbientLight");
  ambient._object3D.add(new THREE.AmbientLight(opts.ambientColor, opts.ambientIntensity));

  const keyLight = new GameObject("KeyLight");
  const directional = new THREE.DirectionalLight(opts.keyLightColor, opts.keyLightIntensity);
  directional.position.set(...opts.keyLightPosition);
  keyLight._object3D.add(directional);

  return { ambient, keyLight };
}
