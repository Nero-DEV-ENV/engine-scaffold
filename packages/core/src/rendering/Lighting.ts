import * as THREE from "three";
import { GameObject } from "../core/GameObject.js";
import { Light } from "./Light.js";

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
  /** GameObject che porta un Light Component di tipo "ambient". */
  ambient: GameObject;
  /** GameObject che porta un Light Component di tipo "directional" (key light). */
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
 *
 * Da Fase 5B.4: entrambi i GameObject portano un vero `Light` Component
 * (packages/core/src/rendering/Light.ts) invece di una `THREE.Light` grezza
 * aggiunta direttamente all'Object3D — necessario perché una luce sopravviva
 * a un ciclo save/load (vedi SceneSerializer.ts). `ambientColor`/
 * `keyLightColor` restano tipizzati `THREE.ColorRepresentation` per
 * flessibilità dell'API pubblica (stringa/numero/Color), ma vengono
 * convertiti a un numero esadecimale prima di essere assegnati a
 * `Light.color`, che è `number` — stessa convenzione JSON-safe già usata da
 * `MeshRenderer.color`.
 */
export function createBasicLighting(options: BasicLightingOptions = {}): BasicLighting {
  const opts = { ...DEFAULTS, ...options };

  const ambient = new GameObject("AmbientLight");
  const ambientLight = ambient.addComponent(Light);
  ambientLight.kind = { kind: "ambient" };
  ambientLight.color = new THREE.Color(opts.ambientColor).getHex();
  ambientLight.intensity = opts.ambientIntensity;

  const keyLight = new GameObject("KeyLight");
  const keyLightComponent = keyLight.addComponent(Light);
  const [x, y, z] = opts.keyLightPosition;
  keyLightComponent.kind = { kind: "directional", position: { x, y, z } };
  keyLightComponent.color = new THREE.Color(opts.keyLightColor).getHex();
  keyLightComponent.intensity = opts.keyLightIntensity;

  return { ambient, keyLight };
}
