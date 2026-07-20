import * as THREE from "three";
import {
  Engine,
  GameObject,
  createRenderer,
  attachAutoResize,
  createBasicLighting,
  OrbitCameraController,
  loadGLTF,
} from "@engine/core";
import { RotateOverTime } from "./RotateOverTime.js";

// Asset di esempio (Khronos glTF-Sample-Assets — pubblico, nessuna build
// step necessaria). Sostituiscilo con un path locale sotto apps/playground/public/
// (es. "/models/tuo-modello.glb") quando avrai un asset del progetto vero.
const DEMO_MODEL_URL =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb";

async function main(): Promise<void> {
  const container = document.getElementById("app");
  if (!container) throw new Error('main.ts: elemento #app non trovato in index.html');

  // ---- Rendering pipeline (Fase 2) -----------------------------------
  // WebGPURenderer con fallback automatico a WebGL2 se `navigator.gpu`
  // non è disponibile (comportamento nativo three.js, vedi Renderer.ts).
  const { renderer, isWebGPU } = await createRenderer({ container });
  console.info(`[engine] rendering backend: ${isWebGPU ? "WebGPU" : "WebGL2 (fallback)"}`);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 1.5, 4);

  const cameraController = new OrbitCameraController(camera, renderer.domElement);
  cameraController.setTarget(0, 0.5, 0);

  attachAutoResize(renderer, camera);

  // ---- Illuminazione base ---------------------------------------------
  const lighting = createBasicLighting();
  scene.add(lighting.ambient._object3D, lighting.keyLight._object3D);

  // ---- Modello GLTF importato (deliverable principale della Fase 2) ---
  // Se il caricamento fallisce (es. nessuna rete), mostriamo un cubo
  // rotante al suo posto: la scena resta comunque "viva" e l'errore
  // finisce in console invece che in uno schermo nero silenzioso.
  try {
    const model = await loadGLTF(DEMO_MODEL_URL, "DemoModel");
    model.gameObject.transform.setPosition(0, 0, 0);
    scene.add(model.gameObject._object3D);
  } catch (error) {
    console.error("[engine] caricamento modello GLTF fallito, uso il cubo di fallback:", error);
    const fallbackGO = new GameObject("FallbackCube");
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x4f8ef7 })
    );
    fallbackGO._object3D.add(mesh);
    scene.add(fallbackGO._object3D);
    fallbackGO.addComponent(RotateOverTime).speed = 0.8;
  }

  // ---- Game loop ---------------------------------------------------------
  const engine = new Engine((dt) => {
    cameraController.update(dt);
    renderer.render(scene, camera);
  });
  engine.start();
}

main().catch((error) => {
  console.error("[engine] avvio del playground fallito:", error);
});
