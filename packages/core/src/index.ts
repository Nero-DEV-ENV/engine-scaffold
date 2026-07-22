// Fase 1 — core runtime del motore.
// Punto d'ingresso pubblico del package @engine/core: riesporta le
// classi/funzioni che formano l'API rivolta all'utente (Unity-style).

export { Time } from "./Time.js";
export { Engine } from "./Engine.js";

export { GameObject, Instantiate, Destroy } from "./core/GameObject.js";
export { Transform } from "./core/Transform.js";
export { Component } from "./core/Component.js";
export type { ComponentType, ComponentQueryType } from "./core/Component.js";

// Fase 2 — rendering pipeline e asset loading.
export { createRenderer, attachAutoResize } from "./rendering/Renderer.js";
export type { CreateRendererOptions, RendererInfo } from "./rendering/Renderer.js";

export { OrbitCameraController } from "./rendering/CameraController.js";

export { createBasicLighting } from "./rendering/Lighting.js";
export type { BasicLighting, BasicLightingOptions } from "./rendering/Lighting.js";

export { loadGLTF } from "./rendering/AssetLoader.js";
export type { LoadedModel } from "./rendering/AssetLoader.js";

export { MeshRenderer } from "./rendering/MeshRenderer.js";
export type { MeshShape } from "./rendering/MeshRenderer.js";

export { Light } from "./rendering/Light.js";
export type { LightKind } from "./rendering/Light.js";

// Fase 3 — fisica (Rapier/WASM).
export { RigidBody, RigidBodyType } from "./physics/RigidBody.js";
export { Collider, BoxCollider, SphereCollider } from "./physics/Collider.js";
export { initPhysics, setGravity, raycast, step as physicsStep, Physics } from "./physics/Physics.js";
export type { InitPhysicsOptions, RaycastHit } from "./physics/Physics.js";

// Fase 5 — serializzazione scene/prefab (JSON).
export { serializeScene, deserializeScene } from "./serialization/SceneSerializer.js";
export type {
  SceneData,
  GameObjectData,
  ComponentData,
  TransformData,
  Vector3Data,
  QuaternionData,
  MeshRendererData,
  LightData,
  RigidBodyData,
  BoxColliderData,
  SphereColliderData,
} from "./serialization/types.js";
