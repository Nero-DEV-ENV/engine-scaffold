import * as THREE from "three";
import {
  Engine,
  GameObject,
  createRenderer,
  createBasicLighting,
  OrbitCameraController,
} from "@engine/core";

/**
 * createEditorScene — bootstrap imperativo della scena three.js/@engine/core
 * per il viewport dell'editor. Stesso stile di apps/playground/src/main.ts
 * (Fase 2/3): nessuna astrazione React qui dentro, solo Engine/GameObject/
 * renderer — il componente React (Viewport.tsx) si limita a chiamare questa
 * funzione una volta e a inoltrarle i resize del suo container.
 *
 * Scena demo Fase 4A: un piano + due primitive (Cube/Sphere), nessuna
 * gerarchia parent/child ancora — la Hierarchy vera arriva in Fase 4B e per
 * ora non ha bisogno di altro che GameObject "piatti" da elencare.
 */

export interface EditorSceneHandle {
  readonly engine: Engine;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Da chiamare ad ogni resize del container (via ResizeObserver, non window resize — vedi Viewport.tsx). */
  setSize(width: number, height: number): void;
  /** Ferma il loop, rilascia renderer/controls e libera il registry globale dei GameObject (vedi Scene.ts). */
  dispose(): void;
}

export async function createEditorScene(container: HTMLElement): Promise<EditorSceneHandle> {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  // Non passiamo `container` a createRenderer: appendiamo il canvas noi
  // stessi qui sotto, dopo avergli dato la classe CSS che lo dimensiona
  // al 100% del pannello (vedi App.css) — stesso risultato del parametro
  // `container`, ma esplicito sul fatto che le dimensioni reali arrivano
  // dal CSS del pannello, non da createRenderer.
  const { renderer } = await createRenderer({ width, height });
  renderer.domElement.classList.add("viewport-canvas");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d21);

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  camera.position.set(4, 3, 6);

  const cameraController = new OrbitCameraController(camera, renderer.domElement);
  cameraController.setTarget(0, 0.5, 0);

  const lighting = createBasicLighting();
  scene.add(lighting.ambient._object3D, lighting.keyLight._object3D);

  const groundGO = new GameObject("Ground");
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x2f3237 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundGO._object3D.add(groundMesh);
  scene.add(groundGO._object3D);

  const cubeGO = new GameObject("Cube");
  cubeGO.transform.setPosition(-1, 0.5, 0);
  cubeGO._object3D.add(
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4f8ef7 }))
  );
  scene.add(cubeGO._object3D);

  const sphereGO = new GameObject("Sphere");
  sphereGO.transform.setPosition(1, 0.5, 0);
  sphereGO._object3D.add(
    new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), new THREE.MeshStandardMaterial({ color: 0xe0663f }))
  );
  scene.add(sphereGO._object3D);

  const engine = new Engine((dt) => {
    cameraController.update(dt);
    renderer.render(scene, camera);
  });
  engine.start();

  function setSize(newWidth: number, newHeight: number): void {
    if (newWidth <= 0 || newHeight <= 0) return;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // updateStyle=false: il canvas è dimensionato via CSS dal pannello
    // (width/height: 100%), non vogliamo che three.js sovrascriva lo
    // style inline con px assoluti ad ogni resize.
    renderer.setSize(newWidth, newHeight, false);
  }

  function dispose(): void {
    engine.stop();
    cameraController.dispose();
    renderer.domElement.remove();
    renderer.dispose();
    // Scene.ts (packages/core) tiene un registry dei GameObject vivi a
    // livello di MODULO, non scoped per istanza: senza questo reset, uno
    // smontaggio/rimontaggio del pannello (HMR, o il doppio invoke degli
    // effect in React StrictMode) farebbe accumulare GameObject "fantasma"
    // della scena precedente nel game loop successivo.
    Engine._resetAll();
  }

  return { engine, scene, camera, setSize, dispose };
}
