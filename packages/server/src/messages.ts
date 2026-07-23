import type { TransformData } from "@engine/core";

/**
 * messages.ts — payload e validazione dei messaggi client→server. File
 * separato (non inline in EditorRoom.ts) perché 6C/6D aggiungeranno altri
 * tipi di messaggio qui (es. `addGameObject`, `removeGameObject`,
 * `addComponent`) seguendo lo stesso pattern.
 *
 * Validazione manuale (non Zod, che pure è già peer dependency di
 * @colyseus/core e supportata nativamente da `onMessage` in 0.17 via
 * `validate()`): tenuta minimale per non allargare la superficie di questa
 * fase — da rivalutare in una eventuale fase di hardening dedicata, stesso
 * pattern già seguito con Fase 5C rispetto a 5A/5B.
 */

export interface HydrateSceneMessage {
  gameObjects: Array<{ id: string; transform: TransformData }>;
}

export interface CommitTransformMessage {
  gameObjectId: string;
  transform: TransformData;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVector3Data(value: unknown): value is TransformData["position"] {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.z);
}

function isQuaternionData(value: unknown): value is TransformData["rotation"] {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isVector3Data(value) && isFiniteNumber(v.w);
}

export function isTransformData(value: unknown): value is TransformData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isVector3Data(v.position) && isQuaternionData(v.rotation) && isVector3Data(v.scale);
}

export function isCommitTransformMessage(value: unknown): value is CommitTransformMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.gameObjectId === "string" && v.gameObjectId.length > 0 && isTransformData(v.transform);
}

export function isHydrateSceneMessage(value: unknown): value is HydrateSceneMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.gameObjects)) return false;
  return v.gameObjects.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.id === "string" && e.id.length > 0 && isTransformData(e.transform);
  });
}
