import * as THREE from "three";
import { GameObject, Destroy } from "../core/GameObject.js";
import type { Component } from "../core/Component.js";
import { MeshRenderer } from "../rendering/MeshRenderer.js";
import { Light } from "../rendering/Light.js";
import { RigidBody } from "../physics/RigidBody.js";
import { BoxCollider, SphereCollider } from "../physics/Collider.js";
import type { SceneData, GameObjectData, ComponentData, TransformData } from "./types.js";

/** Versione corrente del formato — vedi il commento su `SceneData.version` in types.ts. */
const SCENE_FORMAT_VERSION = 1 as const;

// ---- Serializzazione (runtime → dato) ----------------------------------

/**
 * Esportata da Fase 6B.client-1: il protocollo Colyseus lato editor
 * (packages/editor/src/network/collabClient.ts) invia/riceve TransformData
 * per singolo GameObject (non l'intero SceneData) — riusa questa
 * conversione invece di duplicarla, così resta l'unica fonte di verità per
 * "come si legge un Transform da un GameObject".
 */
export function serializeTransform(go: GameObject): TransformData {
  const p = go.transform.position;
  const r = go.transform.rotation;
  const s = go.transform.localScale;
  return {
    position: { x: p.x, y: p.y, z: p.z },
    rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    scale: { x: s.x, y: s.y, z: s.z },
  };
}

/**
 * Serializza un singolo Component in dato JSON-safe, o `null` se il tipo non
 * ha (ancora) uno stato serializzabile riconosciuto da questo modulo — es.
 * componenti di solo comportamento come `RotateOverTime` (apps/playground),
 * che non fanno parte dell'API pubblica di `@engine/core`: un componente
 * custom di un progetto consumer non può essere serializzato genericamente
 * da qui senza un meccanismo di registrazione esterno, fuori scope per
 * questa fase (nessun consumer di questo tipo esiste ancora nell'editor).
 */
export function serializeComponent(component: Component): ComponentData | null {
  if (component instanceof MeshRenderer) {
    return { type: "MeshRenderer", shape: component.shape, color: component.color };
  }
  if (component instanceof Light) {
    return {
      type: "Light",
      lightKind: component.kind,
      color: component.color,
      intensity: component.intensity,
    };
  }
  if (component instanceof RigidBody) {
    return { type: "RigidBody", bodyType: component.type, gravityScale: component.gravityScale };
  }
  if (component instanceof BoxCollider) {
    return {
      type: "BoxCollider",
      size: { ...component.size },
      friction: component.friction,
      restitution: component.restitution,
      isTrigger: component.isTrigger,
    };
  }
  if (component instanceof SphereCollider) {
    return {
      type: "SphereCollider",
      radius: component.radius,
      friction: component.friction,
      restitution: component.restitution,
      isTrigger: component.isTrigger,
    };
  }
  return null;
}

function serializeGameObject(go: GameObject): GameObjectData {
  const components: ComponentData[] = [];
  for (const component of go._getAllComponents()) {
    const data = serializeComponent(component);
    if (data) components.push(data);
  }

  const children: GameObjectData[] = [];
  for (const child of go._object3D.children) {
    // Solo i figli che sono a loro volta un GameObject (marcati in
    // userData["__gameObject"], vedi GameObject.ts) generano un nodo: i figli
    // Object3D "nudi" — es. la Mesh interna di MeshRenderer, aggiunta come
    // figlio diretto dell'Object3D del GameObject — non sono GameObject e
    // vanno saltati. Stesso filtro già usato da scene/hierarchy.ts nell'editor
    // per lo stesso identico motivo.
    const childGO = child.userData["__gameObject"] as GameObject | undefined;
    if (childGO) children.push(serializeGameObject(childGO));
  }

  return {
    id: go.id,
    name: go.name,
    active: go.active,
    transform: serializeTransform(go),
    components,
    children,
  };
}

/** Serializza un albero di GameObject radice in un SceneData completo, pronto per `JSON.stringify`. */
export function serializeScene(roots: readonly GameObject[]): SceneData {
  return {
    version: SCENE_FORMAT_VERSION,
    roots: roots.map(serializeGameObject),
  };
}

// ---- Deserializzazione (dato → runtime) --------------------------------

/**
 * Esportata da Fase 6B.client-1 per lo stesso motivo di `serializeTransform`
 * sopra: applicare un TransformData ricevuto dal server (commitTransform di
 * un altro client, o l'hydrate iniziale) a un GameObject locale già
 * esistente, senza duplicare la conversione qui e in packages/editor.
 */
export function applyTransformData(go: GameObject, data: TransformData): void {
  go.transform.position = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
  go.transform.rotation = new THREE.Quaternion(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);
  go.transform.localScale = new THREE.Vector3(data.scale.x, data.scale.y, data.scale.z);
}

/**
 * Fase 6D: esportata (era privata) — riusata da
 * `EditorSceneHandle.addComponent` (createEditorScene.ts) per il percorso
 * "crea componente + imposta campi", identico a quanto già faceva questa
 * funzione per `deserializeGameObject` sotto, invece di duplicare lo stesso
 * switch esaustivo in due punti del monorepo.
 */
export function applyComponentData(go: GameObject, data: ComponentData): void {
  switch (data.type) {
    case "MeshRenderer": {
      const renderer = go.addComponent(MeshRenderer);
      renderer.shape = data.shape;
      renderer.color = data.color;
      return;
    }
    case "Light": {
      const light = go.addComponent(Light);
      light.kind = data.lightKind;
      light.color = data.color;
      light.intensity = data.intensity;
      return;
    }
    case "RigidBody": {
      const rigidBody = go.addComponent(RigidBody);
      rigidBody.type = data.bodyType;
      rigidBody.gravityScale = data.gravityScale;
      return;
    }
    case "BoxCollider": {
      const collider = go.addComponent(BoxCollider);
      collider.size = { ...data.size };
      collider.friction = data.friction;
      collider.restitution = data.restitution;
      collider.isTrigger = data.isTrigger;
      return;
    }
    case "SphereCollider": {
      const collider = go.addComponent(SphereCollider);
      collider.radius = data.radius;
      collider.friction = data.friction;
      collider.restitution = data.restitution;
      collider.isTrigger = data.isTrigger;
      return;
    }
    default: {
      // Controllo di esaustività: se in futuro si aggiunge un membro a
      // ComponentData senza gestirlo qui, la build fallisce invece di un bug
      // silenzioso a runtime (stesso pattern di RigidBody.ts/Collider.ts).
      const exhaustive: never = data;
      throw new Error(`ComponentData.type non gestito: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Aggiorna i campi di un Component GIÀ ESISTENTE con un ComponentData
 * (Fase 6D) — a differenza di `applyComponentData` sopra, che ne crea uno
 * nuovo via `go.addComponent`, questa funzione non tocca l'esistenza del
 * componente: usata dal percorso di update remoto in collabClient.ts,
 * dove il componente locale corrispondente è già presente (creato in
 * precedenza da un `addComponent` sincronizzato) e vanno solo aggiornati i
 * suoi campi. Lancia se il componente concreto passato non corrisponde al
 * `data.type` atteso: non dovrebbe mai accadere per costruzione (il
 * chiamante verifica `getComponent` prima di invocare questa funzione), ma
 * un mismatch qui indicherebbe un bug di chiamata — un errore esplicito è
 * preferibile ad aggiornare in silenzio i campi sbagliati.
 */
export function updateComponentData(component: Component, data: ComponentData): void {
  switch (data.type) {
    case "MeshRenderer": {
      if (!(component instanceof MeshRenderer)) {
        throw new Error(`updateComponentData: atteso MeshRenderer, ricevuto ${component.constructor.name}`);
      }
      component.shape = data.shape;
      component.color = data.color;
      return;
    }
    case "Light": {
      if (!(component instanceof Light)) {
        throw new Error(`updateComponentData: atteso Light, ricevuto ${component.constructor.name}`);
      }
      component.kind = data.lightKind;
      component.color = data.color;
      component.intensity = data.intensity;
      return;
    }
    case "RigidBody": {
      if (!(component instanceof RigidBody)) {
        throw new Error(`updateComponentData: atteso RigidBody, ricevuto ${component.constructor.name}`);
      }
      component.type = data.bodyType;
      component.gravityScale = data.gravityScale;
      return;
    }
    case "BoxCollider": {
      if (!(component instanceof BoxCollider)) {
        throw new Error(`updateComponentData: atteso BoxCollider, ricevuto ${component.constructor.name}`);
      }
      component.size = { ...data.size };
      component.friction = data.friction;
      component.restitution = data.restitution;
      component.isTrigger = data.isTrigger;
      return;
    }
    case "SphereCollider": {
      if (!(component instanceof SphereCollider)) {
        throw new Error(`updateComponentData: atteso SphereCollider, ricevuto ${component.constructor.name}`);
      }
      component.radius = data.radius;
      component.friction = data.friction;
      component.restitution = data.restitution;
      component.isTrigger = data.isTrigger;
      return;
    }
    default: {
      const exhaustive: never = data;
      throw new Error(`ComponentData.type non gestito: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function deserializeGameObject(
  data: GameObjectData,
  parent: GameObject | null,
  created: GameObject[]
): GameObject {
  const go = new GameObject(data.name, data.id);
  created.push(go);
  go.setActive(data.active);
  applyTransformData(go, data.transform);
  if (parent) go.transform.setParent(parent.transform);

  for (const componentData of data.components) {
    applyComponentData(go, componentData);
  }
  for (const childData of data.children) {
    deserializeGameObject(childData, go, created);
  }
  return go;
}

/**
 * Deserializza un SceneData in un albero di GameObject vivi, registrati nella
 * Scene corrente (stesso registry globale usato da `Instantiate`, vedi
 * Scene.ts) — chi chiama deve trovarsi in un contesto dove tale registry è
 * quello giusto (es. dopo `Engine._resetAll()`, come già avviene al
 * dispose/remount del Viewport dell'editor). I GameObject radice restituiti
 * NON sono aggiunti automaticamente a una `THREE.Scene`: come per
 * `Instantiate`/il pattern esistente in `createEditorScene.ts`, è compito del
 * chiamante fare `scene.add(root._object3D)` per ciascuno.
 *
 * Exception-safe (Fase 5C.4): un `SceneData` corrotto/malformato può far
 * lanciare la ricostruzione a metà albero — un `ComponentData.type` non
 * riconosciuto (controllo di esaustività sotto), ma anche un valore interno
 * non riconosciuto di un tipo altrimenti valido (es. `MeshShape.kind`,
 * `LightKind.kind`: controlli di esaustività analoghi, sincroni, dentro i
 * setter di MeshRenderer.shape/Light.kind). `GameObject` si registra nel
 * registry di Scene.ts nel proprio costruttore, PRIMA che componenti/figli
 * vengano applicati: senza il try/catch sotto, i GameObject già costruiti al
 * momento del throw (radici precedenti completate con successo, più il nodo
 * che ha appena lanciato) resterebbero "fantasmi" nel registry — mai
 * restituiti al chiamante né aggiunti a una THREE.Scene, ma ancora vivi nel
 * game loop. `created` accumula ogni GameObject via via costruito in questa
 * chiamata, a qualunque profondità dell'albero, non solo le radici: su un
 * fallimento li distruggiamo tutti (stesso `Destroy()` usato ovunque nel
 * motore — la rimozione dal registry resta quindi rimandata al prossimo
 * flush di fine-frame, nessun comportamento nuovo) prima di ripropagare
 * l'errore originale. Il registry torna così esattamente come prima della
 * chiamata: la deserializzazione è tutto-o-niente.
 */
export function deserializeScene(data: SceneData): GameObject[] {
  if (data.version !== SCENE_FORMAT_VERSION) {
    throw new Error(
      `deserializeScene: versione formato non supportata (${String(data.version)}, attesa ${String(SCENE_FORMAT_VERSION)})`
    );
  }
  const created: GameObject[] = [];
  try {
    return data.roots.map((rootData) => deserializeGameObject(rootData, null, created));
  } catch (error) {
    for (const go of created) {
      Destroy(go);
    }
    throw error;
  }
}
