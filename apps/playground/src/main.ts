import * as THREE from "three";
import {
  Engine,
  GameObject,
  createRenderer,
  attachAutoResize,
  createBasicLighting,
  OrbitCameraController,
  loadGLTF,
  initPhysics,
  RigidBody,
  RigidBodyType,
  BoxCollider,
  Physics,
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
  camera.position.set(3, 2.5, 7);

  const cameraController = new OrbitCameraController(camera, renderer.domElement);
  cameraController.setTarget(1, 0.3, 0);

  attachAutoResize(renderer, camera);

  // ---- Illuminazione base ---------------------------------------------
  const lighting = createBasicLighting();
  scene.add(lighting.ambient._object3D, lighting.keyLight._object3D);

  // ---- Fisica (Fase 3) ------------------------------------------------
  // await PRIMA di engine.start(), stesso motivo/pattern di createRenderer
  // sopra: se RigidBody/Collider venissero aggiunti (o l'Engine iniziasse
  // a ticchettare) prima che il WASM di Rapier sia pronto, Physics.step()
  // fallirebbe rumorosamente (vedi il commento su initPhysics in
  // packages/core/src/physics/Physics.ts).
  await initPhysics();

  // Piano: solo un Collider, senza RigidBody — diventa un collider Rapier
  // "standalone" implicitamente statico (vedi Collider.ts). Non ha bisogno
  // di muoversi, quindi non serve un RigidBody di tipo Fixed per questo.
  const groundGO = new GameObject("PhysicsGround");
  groundGO.transform.setPosition(0, -1, 0);
  const groundMesh = new THREE.Mesh(
    new THREE.BoxGeometry(20, 0.4, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a3f36 })
  );
  groundGO._object3D.add(groundMesh);
  scene.add(groundGO._object3D);
  const groundCollider = groundGO.addComponent(BoxCollider);
  groundCollider.size = { x: 20, y: 0.4, z: 20 };

  // Cubo: RigidBody dynamic + BoxCollider con restitution > 0 per il
  // rimbalzo — deliverable della fase ("un cubo che cade per gravità e
  // rimbalza su un piano"). Spostato a x=2 per non sovrapporsi visivamente
  // al modello/cubo di fallback della Fase 2, che resta all'origine.
  const physicsCubeGO = new GameObject("PhysicsCube");
  physicsCubeGO.transform.setPosition(2, 4, 0);
  const physicsCubeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xe0663f })
  );
  physicsCubeGO._object3D.add(physicsCubeMesh);
  scene.add(physicsCubeGO._object3D);
  const physicsCubeBody = physicsCubeGO.addComponent(RigidBody);
  physicsCubeBody.type = RigidBodyType.Dynamic;
  const physicsCubeCollider = physicsCubeGO.addComponent(BoxCollider);
  physicsCubeCollider.size = { x: 1, y: 1, z: 1 };
  physicsCubeCollider.restitution = 0.6;

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
  const engine = new Engine(
    (dt) => {
      cameraController.update(dt);
      renderer.render(scene, camera);
    },
    Physics.step
  );
  engine.start();
}

main().catch((error) => {
  console.error("[engine] avvio del playground fallito:", error);
});
