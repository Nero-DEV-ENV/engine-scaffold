import * as THREE from "three";
import { Engine, GameObject } from "@engine/core";
import { RotateOverTime } from "./RotateOverTime.js";

// ---- Setup rendering three.js "a mano" ----------------------------
// La pipeline di rendering vera e propria (WebGPURenderer, camera
// helper, ecc.) arriva in Fase 2. Per ora il playground si occupa
// direttamente di renderer/camera/scene three.js: l'unica cosa che
// passa dal motore è il game loop (Engine) e il GameObject del cubo.

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("app")?.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

// ---- Cubo rotante come GameObject del motore -----------------------

const cubeGO = new GameObject("Cube");
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x4f8ef7 })
);
cubeGO._object3D.add(mesh);
scene.add(cubeGO._object3D);

cubeGO.addComponent(RotateOverTime).speed = 0.8;

// ---- Game loop -------------------------------------------------------

const engine = new Engine(() => {
  renderer.render(scene, camera);
});
engine.start();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
