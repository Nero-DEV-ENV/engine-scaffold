import { createExternalStore } from "../store/editorStore.js";
import type { MeshRendererData } from "@engine/core";

/**
 * textureAssignment.ts — Fase 11B.1, punto aperto 1 confermato dall'utente:
 * meccanismo di assegnazione a due gesti — bottone "Scegli texture..." in
 * Inspector.tsx "arma" lo slot Albedo del MeshRenderer del GameObject
 * selezionato, poi un doppio click su una texture in ProjectTree.tsx/
 * ProjectFolderGrid.tsx completa l'assegnazione. Preferito a un file-picker
 * modale dedicato perché riusa l'infrastruttura di doppio click già
 * esistente (Fase 10C) invece di introdurne una nuova, e scala pulito a
 * Fase 11B.2 (Normal/Roughness/Metalness/AO/Emissive): ogni mappa avrà il
 * proprio bottone "Scegli...", ciascuno arma un `field` diverso sullo
 * stesso `ArmedTextureSlot`.
 *
 * `armedTextureSlotStore` vive qui (non in editorStore.ts): è uno stato
 * specifico dell'assegnazione texture, non un concetto generale di editor
 * come selectionStore/sceneRootsStore — stessa logica di cartellizzazione
 * già seguita per gli altri store dedicati del progetto (es.
 * `projectRootStore` in projectFolderClient.ts, non in editorStore.ts).
 */
export interface ArmedTextureSlot {
  gameObjectId: string;
  field: "albedoMap";
}

export const armedTextureSlotStore = createExternalStore<ArmedTextureSlot | null>(null);

/**
 * armAlbedoMapSlot — arma lo slot Albedo per `gameObjectId`. Cliccare di
 * nuovo il bottone mentre lo STESSO slot è già armato lo disarma (toggle a
 * due stati, stesso linguaggio di un bottone premuto/rilasciato) invece di
 * ri-armarlo su se stesso senza alcun effetto visibile.
 */
export function armAlbedoMapSlot(gameObjectId: string): void {
  const current = armedTextureSlotStore.get();
  if (current && current.gameObjectId === gameObjectId && current.field === "albedoMap") {
    armedTextureSlotStore.set(null);
  } else {
    armedTextureSlotStore.set({ gameObjectId, field: "albedoMap" });
  }
}

/** Disarma lo slot corrente (qualunque esso sia), no-op se già disarmato. */
export function disarmTextureSlot(): void {
  armedTextureSlotStore.set(null);
}

/**
 * resolveTextureAssignment — logica pura (nessun accesso a store/DOM, per
 * essere testata senza mock): dato lo slot attualmente armato, l'id del
 * GameObject correntemente selezionato, la `MeshRendererData` corrente del
 * suo componente MeshRenderer (o `null` se assente) e il percorso relativo
 * della texture su cui si è fatto doppio click, calcola la
 * `MeshRendererData` aggiornata da inviare a
 * `EditorSceneHandle.updateComponent`, o `null` se l'assegnazione non è
 * applicabile: nessuno slot armato, la selezione non combacia più col
 * GameObject per cui lo slot era stato armato (es. l'utente ha selezionato
 * un altro oggetto nel frattempo), o il GameObject selezionato non ha
 * (più) un componente MeshRenderer.
 */
export function resolveTextureAssignment(
  armedSlot: ArmedTextureSlot | null,
  selectedGameObjectId: string | null,
  meshRendererData: MeshRendererData | null,
  relativePath: string
): MeshRendererData | null {
  if (!armedSlot || armedSlot.gameObjectId !== selectedGameObjectId) return null;
  if (!meshRendererData) return null;
  return {
    ...meshRendererData,
    [armedSlot.field]: relativePath,
    // Fase 11B.1 (addendum, richiesto dall'utente durante lo smoke-test):
    // `MeshStandardMaterial` moltiplica SEMPRE `color × map` (comportamento
    // PBR standard, non un bug) — un `color` non bianco già impostato
    // tingerebbe la texture appena assegnata in modo sorprendente per
    // l'utente. Solo per `albedoMap` (le mappe future di 11B.2 — Normal/
    // Roughness/Metalness/AO/Emissive — non sono moltiplicate per `color`
    // allo stesso modo, quindi non serve lo stesso reset): resettato a
    // bianco (0xffffff) ad ogni assegnazione, l'utente può comunque
    // ritingerla di proposito dopo dal color-picker in Inspector se lo
    // desidera davvero.
    ...(armedSlot.field === "albedoMap" ? { color: 0xffffff } : {}),
  };
}
