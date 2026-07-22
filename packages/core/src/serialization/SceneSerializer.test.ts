import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../Engine.js";
import { GameObject } from "../core/GameObject.js";
import { Component } from "../core/Component.js";
import { MeshRenderer } from "../rendering/MeshRenderer.js";
import { RigidBody, RigidBodyType } from "../physics/RigidBody.js";
import { BoxCollider, SphereCollider } from "../physics/Collider.js";
import { serializeScene, deserializeScene } from "./SceneSerializer.js";
import type { SceneData } from "./types.js";

/** Round-trip completo attraverso JSON.stringify/parse: verifica che il dato sia davvero JSON-safe, non solo strutturalmente compatibile in memoria. */
function throughJSON(data: SceneData): SceneData {
  return JSON.parse(JSON.stringify(data)) as SceneData;
}

describe("SceneSerializer", () => {
  beforeEach(() => {
    Engine._resetAll();
  });

  it("serializza posizione/rotazione/scala del Transform come quaternion", () => {
    const go = new GameObject("Test");
    go.transform.setPosition(1, 2, 3);
    go.transform.setEulerAngles(0, Math.PI / 2, 0);
    go.transform.setLocalScale(2, 2, 2);

    const data = throughJSON(serializeScene([go]));
    const root = data.roots[0]!;

    expect(root.transform.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(root.transform.scale).toEqual({ x: 2, y: 2, z: 2 });
    // Confronto sul quaternion effettivo (non sugli euler): è la fonte di
    // verità serializzata, vedi il commento in types.ts.
    expect(root.transform.rotation.y).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(root.transform.rotation.w).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it("round-trip: id, name e active sopravvivono a serializzazione+deserializzazione", () => {
    const go = new GameObject("Nave");
    go.setActive(false);

    const data = throughJSON(serializeScene([go]));
    const [restored] = deserializeScene(data);

    expect(restored!.id).toBe(go.id);
    expect(restored!.name).toBe("Nave");
    expect(restored!.active).toBe(false);
  });

  it("round-trip: la gerarchia parent/children è preservata", () => {
    const parent = new GameObject("Props");
    const childA = new GameObject("A");
    const childB = new GameObject("B");
    childA.transform.setParent(parent.transform);
    childB.transform.setParent(parent.transform);

    const data = throughJSON(serializeScene([parent]));
    const [restoredParent] = deserializeScene(data);

    const childrenNames = restoredParent!.transform._object3D.children
      .map((c) => (c.userData["__gameObject"] as GameObject).name)
      .sort();
    expect(childrenNames).toEqual(["A", "B"]);
    expect(childA.transform.parent).toBe(parent.transform);
  });

  it("round-trip: MeshRenderer (forma + colore)", () => {
    const go = new GameObject("Cubo");
    const renderer = go.addComponent(MeshRenderer);
    renderer.shape = { kind: "box", size: { x: 2, y: 1, z: 1 } };
    renderer.color = 0x4f8ef7;

    const data = throughJSON(serializeScene([go]));
    const [restored] = deserializeScene(data);

    const restoredRenderer = restored!.getComponent(MeshRenderer);
    expect(restoredRenderer).not.toBeNull();
    expect(restoredRenderer!.shape).toEqual({ kind: "box", size: { x: 2, y: 1, z: 1 } });
    expect(restoredRenderer!.color).toBe(0x4f8ef7);
  });

  it("round-trip: MeshRenderer con forma sphere/plane", () => {
    const sphereGO = new GameObject("Sfera");
    sphereGO.addComponent(MeshRenderer).shape = { kind: "sphere", radius: 0.75 };
    const planeGO = new GameObject("Piano");
    planeGO.addComponent(MeshRenderer).shape = { kind: "plane", width: 5, height: 8 };

    const data = throughJSON(serializeScene([sphereGO, planeGO]));
    const [restoredSphere, restoredPlane] = deserializeScene(data);

    expect(restoredSphere!.getComponent(MeshRenderer)!.shape).toEqual({ kind: "sphere", radius: 0.75 });
    expect(restoredPlane!.getComponent(MeshRenderer)!.shape).toEqual({ kind: "plane", width: 5, height: 8 });
  });

  it("round-trip: RigidBody (type + gravityScale)", () => {
    const go = new GameObject("Palla");
    const rb = go.addComponent(RigidBody);
    rb.type = RigidBodyType.Kinematic;
    rb.gravityScale = 0.5;

    const data = throughJSON(serializeScene([go]));
    const [restored] = deserializeScene(data);

    const restoredRb = restored!.getComponent(RigidBody);
    expect(restoredRb!.type).toBe(RigidBodyType.Kinematic);
    expect(restoredRb!.gravityScale).toBe(0.5);
  });

  it("round-trip: BoxCollider e SphereCollider (friction/restitution/isTrigger + forma)", () => {
    const boxGO = new GameObject("Box");
    const boxCollider = boxGO.addComponent(BoxCollider);
    boxCollider.size = { x: 2, y: 3, z: 4 };
    boxCollider.friction = 0.2;
    boxCollider.restitution = 0.8;
    boxCollider.isTrigger = true;

    const sphereGO = new GameObject("Sphere");
    const sphereCollider = sphereGO.addComponent(SphereCollider);
    sphereCollider.radius = 1.5;

    const data = throughJSON(serializeScene([boxGO, sphereGO]));
    const [restoredBox, restoredSphere] = deserializeScene(data);

    const restoredBoxCollider = restoredBox!.getComponent(BoxCollider);
    expect(restoredBoxCollider!.size).toEqual({ x: 2, y: 3, z: 4 });
    expect(restoredBoxCollider!.friction).toBe(0.2);
    expect(restoredBoxCollider!.restitution).toBe(0.8);
    expect(restoredBoxCollider!.isTrigger).toBe(true);

    const restoredSphereCollider = restoredSphere!.getComponent(SphereCollider);
    expect(restoredSphereCollider!.radius).toBe(1.5);
  });

  it("un GameObject con più componenti li serializza tutti, nell'ordine di addComponent", () => {
    const go = new GameObject("Composito");
    go.addComponent(MeshRenderer);
    go.addComponent(RigidBody);
    go.addComponent(BoxCollider);

    const data = throughJSON(serializeScene([go]));
    const types = data.roots[0]!.components.map((c) => c.type);
    expect(types).toEqual(["MeshRenderer", "RigidBody", "BoxCollider"]);
  });

  it("deserializeScene rifiuta una versione di formato non supportata", () => {
    const badData = { version: 2, roots: [] } as unknown as SceneData;
    expect(() => deserializeScene(badData)).toThrow(/versione formato/);
  });

  it("deserializeScene registra i GameObject ricostruiti nella Scene corrente (visibili al game loop)", () => {
    const original = new GameObject("Vivo");
    const data = throughJSON(serializeScene([original]));

    Engine._resetAll(); // simula un reload: la scena originale non esiste più
    const [restored] = deserializeScene(data);

    // Un componente-spia aggiunto DOPO la deserializzazione: se update() viene
    // chiamato, il GameObject ricostruito è davvero registrato nel game loop
    // (Scene.ts), non solo un oggetto scollegato restituito da deserializeScene.
    let updateCalls = 0;
    class ProbeComponent extends Component {
      override update(): void {
        updateCalls++;
      }
    }
    restored!.addComponent(ProbeComponent);

    const engine = new Engine();
    engine.step(1 / 60);

    expect(updateCalls).toBe(1);
  });
});
