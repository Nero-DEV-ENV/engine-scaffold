import * as THREE from "three";
import { GameObject } from "../core/GameObject.js";
import type { Component } from "../core/Component.js";
import { MeshRenderer } from "../rendering/MeshRenderer.js";
import { RigidBody } from "../physics/RigidBody.js";
import { BoxCollider, SphereCollider } from "../physics/Collider.js";
import type { SceneData, GameObjectData, ComponentData, TransformData } from "./types.js";

/** Versione corrente del formato — vedi il commento su `SceneData.version` in types.ts. */
const SCENE_FORMAT_VERSION = 1 as const;

// ---- Serializzazione (runtime → dato) ----------------------------------

function serializeTransform(go: GameObject): TransformData {
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
function serializeComponent(component: Component): ComponentData | null {
  if (component instanceof MeshRenderer) {
    return { type: "MeshRenderer", shape: component.shape, color: component.color };
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

function applyTransformData(go: GameObject, data: TransformData): void {
  go.transform.position = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
  go.transform.rotation = new THREE.Quaternion(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);
  go.transform.localScale = new THREE.Vector3(data.scale.x, data.scale.y, data.scale.z);
}

function applyComponentData(go: GameObject, data: ComponentData): void {
  switch (data.type) {
    case "MeshRenderer": {
      const renderer = go.addComponent(MeshRenderer);
      renderer.shape = data.shape;
      renderer.color = data.color;
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

function deserializeGameObject(data: GameObjectData, parent: GameObject | null): GameObject {
  const go = new GameObject(data.name, data.id);
  go.setActive(data.active);
  applyTransformData(go, data.transform);
  if (parent) go.transform.setParent(parent.transform);

  for (const componentData of data.components) {
    applyComponentData(go, componentData);
  }
  for (const childData of data.children) {
    deserializeGameObject(childData, go);
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
 */
export function deserializeScene(data: SceneData): GameObject[] {
  if (data.version !== SCENE_FORMAT_VERSION) {
    throw new Error(
      `deserializeScene: versione formato non supportata (${String(data.version)}, attesa ${String(SCENE_FORMAT_VERSION)})`
    );
  }
  return data.roots.map((rootData) => deserializeGameObject(rootData, null));
}
