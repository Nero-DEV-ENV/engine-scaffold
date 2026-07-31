import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../Engine.js";
import { GameObject } from "../core/GameObject.js";
import { Component } from "../core/Component.js";
import { _getLiveGameObjects } from "../core/Scene.js";
import { MeshRenderer } from "../rendering/MeshRenderer.js";
import { Light } from "../rendering/Light.js";
import { RigidBody, RigidBodyType } from "../physics/RigidBody.js";
import { BoxCollider, SphereCollider } from "../physics/Collider.js";
import { serializeScene, deserializeScene, updateComponentData } from "./SceneSerializer.js";
import type { SceneData, ComponentData } from "./types.js";

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

  it("un GameObject senza sourceAssetId non include il campo nel dato serializzato (Fase 7)", () => {
    const go = new GameObject("Cubo normale");
    const data = throughJSON(serializeScene([go]));
    expect(data.roots[0]!.sourceAssetId).toBeUndefined();
  });

  it("round-trip: sourceAssetId sopravvive a serializzazione+deserializzazione (Fase 7)", () => {
    const go = new GameObject("Albero importato");
    go.sourceAssetId = "asset-123";

    const data = throughJSON(serializeScene([go]));
    expect(data.roots[0]!.sourceAssetId).toBe("asset-123");

    const [restored] = deserializeScene(data);
    expect(restored!.sourceAssetId).toBe("asset-123");
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

  it("round-trip: MeshRenderer metalness/roughness (Fase 11)", () => {
    const go = new GameObject("Sfera metallica");
    const renderer = go.addComponent(MeshRenderer);
    renderer.metalness = 0.8;
    renderer.roughness = 0.2;

    const data = throughJSON(serializeScene([go]));
    expect(data.roots[0]!.components[0]).toMatchObject({ metalness: 0.8, roughness: 0.2 });

    const [restored] = deserializeScene(data);
    const restoredRenderer = restored!.getComponent(MeshRenderer);
    expect(restoredRenderer!.metalness).toBe(0.8);
    expect(restoredRenderer!.roughness).toBe(0.2);
  });

  it("deserializeScene applica i default del motore (metalness 0, roughness 1) a un MeshRenderer serializzato PRIMA di Fase 11 (Fase 11)", () => {
    const legacyData: SceneData = {
      version: 1,
      roots: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Cubo vecchio",
          active: true,
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          // Nessun metalness/roughness: forma esatta di un MeshRenderer
          // serializzato prima di Fase 11 (vedi JSDoc di MeshRendererData
          // in types.ts).
          components: [{ type: "MeshRenderer", shape: { kind: "box", size: { x: 1, y: 1, z: 1 } }, color: 0xffffff } as ComponentData],
          children: [],
        },
      ],
    };

    const [restored] = deserializeScene(legacyData);
    const restoredRenderer = restored!.getComponent(MeshRenderer);
    expect(restoredRenderer!.metalness).toBe(0);
    expect(restoredRenderer!.roughness).toBe(1);
  });

  it("round-trip: Light ambient (color + intensity)", () => {
    const go = new GameObject("AmbientLight");
    const light = go.addComponent(Light);
    light.kind = { kind: "ambient" };
    light.color = 0x336699;
    light.intensity = 0.6;

    const data = throughJSON(serializeScene([go]));
    const [restored] = deserializeScene(data);

    const restoredLight = restored!.getComponent(Light);
    expect(restoredLight).not.toBeNull();
    expect(restoredLight!.kind).toEqual({ kind: "ambient" });
    expect(restoredLight!.color).toBe(0x336699);
    expect(restoredLight!.intensity).toBe(0.6);
  });

  it("round-trip: Light directional (color + intensity + posizione)", () => {
    const go = new GameObject("KeyLight");
    const light = go.addComponent(Light);
    light.kind = { kind: "directional", position: { x: 3, y: 5, z: 2 } };
    light.color = 0xffeedd;
    light.intensity = 2.5;

    const data = throughJSON(serializeScene([go]));
    const [restored] = deserializeScene(data);

    const restoredLight = restored!.getComponent(Light);
    expect(restoredLight!.kind).toEqual({ kind: "directional", position: { x: 3, y: 5, z: 2 } });
    expect(restoredLight!.color).toBe(0xffeedd);
    expect(restoredLight!.intensity).toBe(2.5);
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

  // ---- Fase 5C.4 — atomicità su fallimento parziale --------------------
  // deserializeScene deve essere tutto-o-niente: un dato corrotto/malformato
  // che fa lanciare la ricostruzione a metà albero non deve lasciare
  // GameObject "fantasma" registrati in Scene.ts (vivi nel game loop, mai
  // restituiti al chiamante). Verificato via _getLiveGameObjects() dopo un
  // engine.step(): Destroy() (chiamato dal catch in deserializeScene) rimanda
  // la rimozione effettiva dal registry al flush di fine-frame, stesso
  // comportamento già testato altrove nel motore (vedi sceneLoad.test.ts).

  it("un ComponentData.type non riconosciuto su un nodo a metà albero non lascia fantasmi: entrambe le radici (quella già completata e quella che lancia) vengono ripulite", () => {
    const primaRadiceOk = new GameObject("Prima-ok");
    const secondaRadiceCorrotta = new GameObject("Seconda-corrotta");
    const data = throughJSON(serializeScene([primaRadiceOk, secondaRadiceCorrotta]));
    data.roots[1]!.components.push({ type: "TipoInesistente" } as unknown as ComponentData);

    Engine._resetAll(); // stato pulito, come dopo un vero reload

    expect(() => deserializeScene(data)).toThrow(/ComponentData\.type non gestito/);

    new Engine().step(1 / 60); // flush di fine-frame dei Destroy() interni al catch
    expect(_getLiveGameObjects()).toHaveLength(0);
  });

  it("un valore corrotto dentro una union interna di un componente altrimenti riconosciuto (MeshShape.kind) produce lo stesso identico cleanup", () => {
    const go = new GameObject("Cubo");
    go.addComponent(MeshRenderer).shape = { kind: "box", size: { x: 1, y: 1, z: 1 } };
    const data = throughJSON(serializeScene([go]));
    (data.roots[0]!.components[0] as unknown as { shape: { kind: string } }).shape = { kind: "cono" };

    Engine._resetAll();

    expect(() => deserializeScene(data)).toThrow(/MeshShape non gestita/);

    new Engine().step(1 / 60);
    expect(_getLiveGameObjects()).toHaveLength(0);
  });

  // ---- Fase 6D — updateComponentData (aggiorna un Component ESISTENTE) --
  describe("updateComponentData", () => {
    it("aggiorna i campi di un MeshRenderer esistente senza ricrearlo", () => {
      const go = new GameObject("Cubo");
      const renderer = go.addComponent(MeshRenderer);
      renderer.shape = { kind: "box", size: { x: 1, y: 1, z: 1 } };
      renderer.color = 0xffffff;

      updateComponentData(renderer, {
        type: "MeshRenderer",
        shape: { kind: "sphere", radius: 2 },
        color: 0x123456,
      });

      expect(renderer.shape).toEqual({ kind: "sphere", radius: 2 });
      expect(renderer.color).toBe(0x123456);
      expect(go.getComponent(MeshRenderer)).toBe(renderer); // stessa istanza, non ricreata
    });

    it("aggiorna metalness/roughness di un MeshRenderer esistente (Fase 11)", () => {
      const go = new GameObject("Cubo");
      const renderer = go.addComponent(MeshRenderer);

      updateComponentData(renderer, {
        type: "MeshRenderer",
        shape: { kind: "box", size: { x: 1, y: 1, z: 1 } },
        color: 0xffffff,
        metalness: 0.6,
        roughness: 0.3,
      });

      expect(renderer.metalness).toBe(0.6);
      expect(renderer.roughness).toBe(0.3);
    });

    it("aggiorna i campi di un Light esistente", () => {
      const go = new GameObject("Luce");
      const light = go.addComponent(Light);
      light.kind = { kind: "ambient" };
      light.color = 0x000000;
      light.intensity = 1;

      updateComponentData(light, {
        type: "Light",
        lightKind: { kind: "directional", position: { x: 1, y: 2, z: 3 } },
        color: 0xabcdef,
        intensity: 3,
      });

      expect(light.kind).toEqual({ kind: "directional", position: { x: 1, y: 2, z: 3 } });
      expect(light.color).toBe(0xabcdef);
      expect(light.intensity).toBe(3);
    });

    it("aggiorna i campi di un RigidBody esistente", () => {
      const go = new GameObject("Palla");
      const rb = go.addComponent(RigidBody);
      rb.type = RigidBodyType.Dynamic;
      rb.gravityScale = 1;

      updateComponentData(rb, { type: "RigidBody", bodyType: RigidBodyType.Kinematic, gravityScale: 0.2 });

      expect(rb.type).toBe(RigidBodyType.Kinematic);
      expect(rb.gravityScale).toBe(0.2);
    });

    it("aggiorna i campi di un BoxCollider/SphereCollider esistente", () => {
      const boxGO = new GameObject("Box");
      const boxCollider = boxGO.addComponent(BoxCollider);
      updateComponentData(boxCollider, {
        type: "BoxCollider",
        size: { x: 5, y: 6, z: 7 },
        friction: 0.9,
        restitution: 0.1,
        isTrigger: true,
      });
      expect(boxCollider.size).toEqual({ x: 5, y: 6, z: 7 });
      expect(boxCollider.friction).toBe(0.9);
      expect(boxCollider.restitution).toBe(0.1);
      expect(boxCollider.isTrigger).toBe(true);

      const sphereGO = new GameObject("Sphere");
      const sphereCollider = sphereGO.addComponent(SphereCollider);
      updateComponentData(sphereCollider, {
        type: "SphereCollider",
        radius: 4,
        friction: 0.3,
        restitution: 0.6,
        isTrigger: true,
      });
      expect(sphereCollider.radius).toBe(4);
      expect(sphereCollider.friction).toBe(0.3);
      expect(sphereCollider.restitution).toBe(0.6);
      expect(sphereCollider.isTrigger).toBe(true);
    });

    it("lancia se il Component concreto passato non corrisponde a data.type (mismatch difensivo)", () => {
      const go = new GameObject("Cubo");
      const renderer = go.addComponent(MeshRenderer);

      expect(() =>
        updateComponentData(renderer, { type: "RigidBody", bodyType: RigidBodyType.Dynamic, gravityScale: 1 }),
      ).toThrow(/atteso RigidBody/);
    });
  });
});
