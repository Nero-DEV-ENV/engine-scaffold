import { WebGPURenderer } from "three/webgpu";
import type { WebGPURendererParameters } from "three/webgpu";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import type { PerspectiveCamera } from "three";

/**
 * createRenderer — crea e inizializza un WebGPURenderer (three.js).
 *
 * Nota architetturale: questo è l'UNICO file del motore che importa da
 * "three/webgpu" invece che da "three". Il build "three/webgpu" espone
 * classi (Object3D, Scene, Mesh, ecc.) tecnicamente distinte da quelle
 * del build classico "three" usato altrove nel motore (GameObject,
 * Transform, loader, controls) — ma three.js risolve internamente ogni
 * dispatch via flag duck-typed (`.isMesh`, `.isLight`, `.isCamera`, ecc.)
 * e non via `instanceof`, quindi passare a `renderer.render(scene, camera)`
 * una Scene/Camera "classiche" funziona correttamente. Questo tiene il
 * resto del motore (GameObject/Transform/loader) libero da un import che,
 * a differenza di "three", richiede un `document` reale — impossibile da
 * caricare nei test Vitest in Node.
 *
 * WebGPURenderer senza `forceWebGL` prova WebGPU e, se `navigator.gpu`
 * non è disponibile, esegue da solo il fallback al backend WebGL2
 * (comportamento nativo di three.js, non simulato qui) — vedi
 * `RendererInfo.isWebGPU` per sapere quale backend è effettivamente attivo
 * dopo `init()`.
 */

export interface CreateRendererOptions extends WebGPURendererParameters {
  /** Elemento DOM in cui appendere il canvas. Se omesso, il chiamante deve appendere `renderer.domElement` a mano. */
  container?: HTMLElement;
  /** Larghezza/altezza iniziali in px CSS. Default: dimensioni della finestra. */
  width?: number;
  height?: number;
  /** Se true (default), applica pixelRatio del device e color management "da schermo" (SRGB + ACES). */
  applyDisplayDefaults?: boolean;
}

export interface RendererInfo {
  renderer: WebGPURenderer;
  /** true se il backend attivo dopo init() è WebGPU, false se è scattato il fallback WebGL2. */
  isWebGPU: boolean;
}

/**
 * Crea un WebGPURenderer, lo inizializza (operazione asincrona — richiede
 * di negoziare l'adapter/device GPU) e lo appende al DOM se `container` è
 * fornito. Da chiamare una volta sola prima di avviare l'Engine.
 */
export async function createRenderer(
  options: CreateRendererOptions = {}
): Promise<RendererInfo> {
  const {
    container,
    width = window.innerWidth,
    height = window.innerHeight,
    applyDisplayDefaults = true,
    ...rendererParams
  } = options;

  const renderer = new WebGPURenderer({ antialias: true, ...rendererParams });
  await renderer.init();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);

  if (applyDisplayDefaults) {
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
  }

  if (container) {
    container.appendChild(renderer.domElement);
  }

  // `backend.isWebGPUBackend` è impostato solo dal backend WebGPU reale;
  // il backend di fallback (WebGLBackend) non lo definisce.
  const isWebGPU =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

  return { renderer, isWebGPU };
}

/**
 * Collega un listener di resize della finestra che aggiorna sia l'aspect
 * ratio della camera sia le dimensioni del renderer. Restituisce una
 * funzione di cleanup per rimuovere il listener (es. su hot-reload).
 */
export function attachAutoResize(
  renderer: WebGPURenderer,
  camera: PerspectiveCamera,
  target: Window = window
): () => void {
  const handleResize = (): void => {
    camera.aspect = target.innerWidth / target.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(target.devicePixelRatio, 2));
    renderer.setSize(target.innerWidth, target.innerHeight);
  };
  target.addEventListener("resize", handleResize);
  return () => target.removeEventListener("resize", handleResize);
}
