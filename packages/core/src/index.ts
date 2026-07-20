// Fase 1 — core runtime del motore.
// Punto d'ingresso pubblico del package @engine/core: riesporta le
// classi/funzioni che formano l'API rivolta all'utente (Unity-style).

export { Time } from "./Time.js";
export { Engine } from "./Engine.js";

export { GameObject, Instantiate, Destroy } from "./core/GameObject.js";
export { Transform } from "./core/Transform.js";
export { Component } from "./core/Component.js";
export type { ComponentType } from "./core/Component.js";

// Fase 2 — rendering pipeline e asset loading.
export { createRenderer, attachAutoResize } from "./rendering/Renderer.js";
export type { CreateRendererOptions, RendererInfo } from "./rendering/Renderer.js";

export { OrbitCameraController } from "./rendering/CameraController.js";

export { createBasicLighting } from "./rendering/Lighting.js";
export type { BasicLighting, BasicLightingOptions } from "./rendering/Lighting.js";

export { loadGLTF } from "./rendering/AssetLoader.js";
export type { LoadedModel } from "./rendering/AssetLoader.js";
