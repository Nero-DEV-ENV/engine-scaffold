import { Schema, type, MapSchema } from "@colyseus/schema";
import type { TransformData } from "@engine/core";

/**
 * EditorRoomState.ts — stato condiviso della Fase 6B: solo Transform dei
 * GameObject esistenti (deciso con l'utente: aggiunta/rimozione GameObject
 * e componenti arrivano in 6C/6D).
 *
 * Predisposto per l'ampliamento futuro richiesto esplicitamente dall'utente:
 * `transforms` è una MapSchema keyed per `gameObjectId`, non un array o una
 * struttura a dimensione fissa — aggiungere/rimuovere entry (6C) sarà un
 * `.set()`/`.delete()` su questa stessa mappa, senza dover restrutturare lo
 * schema. Allo stesso modo, 6D (componenti) potrà aggiungere una seconda
 * MapSchema affiancata (es. `components`) seguendo lo stesso pattern, invece
 * di dover ridisegnare EditorRoomState da capo.
 *
 * NOTA TOOLING (verificato empiricamente, non assumibile dalla sola
 * documentazione/training): @colyseus/schema 4.x richiede i decorator
 * TypeScript "legacy" (`experimentalDecorators: true`), non i nuovi
 * decorator nativi TC39 Stage 3 che il resto del monorepo usa di default
 * (tsconfig.base.json non imposta `experimentalDecorators`, quindi TS usa i
 * decorator moderni) — E richiede ANCHE `useDefineForClassFields: false`
 * quando il target è ES2022+ (il nostro caso), altrimenti `@type()` non
 * aggancia correttamente gli accessor get/set su cui si basa il change
 * tracking. Impostato solo in `packages/server/tsconfig.json` (override
 * locale), non nel tsconfig.base.json condiviso — verificato che il resto
 * del monorepo non usa decorator e non è quindi impattato.
 *
 * I nomi dei campi rispecchiano deliberatamente `TransformData` di
 * `@engine/core` (position/rotation/scale, quaternion non euler — stessa
 * scelta e stessa motivazione di `packages/core/src/serialization/types.ts`)
 * per rendere diretta la conversione da/verso `SceneSerializer` in futuro.
 */

export class Vector3State extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
}

export class QuaternionState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") w = 1;
}

export class TransformState extends Schema {
  @type(Vector3State) position = new Vector3State();
  @type(QuaternionState) rotation = new QuaternionState();
  @type(Vector3State) scale = new Vector3State();
}

export class EditorRoomState extends Schema {
  @type({ map: TransformState }) transforms = new MapSchema<TransformState>();
}

/** Costruisce una nuova TransformState da un TransformData (usato in hydrateScene). */
export function toTransformState(data: TransformData): TransformState {
  const state = new TransformState();
  applyTransformData(state, data);
  return state;
}

/**
 * Applica un TransformData a una TransformState ESISTENTE, mutando le
 * proprietà invece di sostituire l'istanza — è il pattern efficiente
 * raccomandato per Colyseus (ogni assegnazione aggiorna il ChangeTree della
 * singola proprietà, invece di forzare la re-serializzazione dell'intero
 * sotto-oggetto). Usato sia da `hydrateScene` sia da `commitTransform`.
 */
export function applyTransformData(state: TransformState, data: TransformData): void {
  state.position.x = data.position.x;
  state.position.y = data.position.y;
  state.position.z = data.position.z;
  state.rotation.x = data.rotation.x;
  state.rotation.y = data.rotation.y;
  state.rotation.z = data.rotation.z;
  state.rotation.w = data.rotation.w;
  state.scale.x = data.scale.x;
  state.scale.y = data.scale.y;
  state.scale.z = data.scale.z;
}
