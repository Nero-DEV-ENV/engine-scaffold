// Fase 1 — core runtime del motore.
// Punto d'ingresso pubblico del package @engine/core: riesporta le
// classi/funzioni che formano l'API rivolta all'utente (Unity-style).

export { Time } from "./Time.js";
export { Engine } from "./Engine.js";

export { GameObject, Instantiate, Destroy } from "./core/GameObject.js";
export { Transform } from "./core/Transform.js";
export { Component } from "./core/Component.js";
export type { ComponentType } from "./core/Component.js";
