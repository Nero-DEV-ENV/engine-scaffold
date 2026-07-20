import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { GameObject } from "../core/GameObject.js";
import { RigidBody, RigidBodyType } from "./RigidBody.js";
import { BoxCollider, SphereCollider } from "./Collider.js";
import { initPhysics, raycast, step, setGravity, _resetPhysics } from "./Physics.js";

const FIXED_DT = 1 / 60;

function stepN(n: number, dt = FIXED_DT): void {
  for (let i = 0; i < n; i++) step(dt);
}

describe("Physics — init e integrazione Rapier", () => {
  beforeEach(() => {
    _resetPhysics();
  });

  it(
    "initPhysics() completa senza errori in ambiente Node/Vitest (rapier3d-compat, nessun fetch())",
    async () => {
      await expect(initPhysics()).resolves.toBeUndefined();
    }
  );

  it("è idempotente: chiamate multiple non ricreano il World", async () => {
    await initPhysics();
    await expect(initPhysics()).resolves.toBeUndefined();
  });

  it("step() senza init e senza componenti registrati è un no-op silenzioso", () => {
    expect(() => step(FIXED_DT)).not.toThrow();
  });

  it("step() senza init MA con componenti registrati fallisce rumorosamente", async () => {
    // Nota: awake() registra il componente subito, prima che initPhysics() sia mai chiamato.
    const go = new GameObject("orfano");
    go.addComponent(RigidBody);
    expect(() => step(FIXED_DT)).toThrow(/initPhysics/);
  });
});

describe("Physics — RigidBody dynamic + gravità", () => {
  beforeEach(async () => {
    _resetPhysics();
    await initPhysics();
  });

  it("un corpo dynamic cade sotto l'effetto della gravità", () => {
    const go = new GameObject("cubo");
    go.transform.setPosition(0, 5, 0);
    const rb = go.addComponent(RigidBody);
    rb.type = RigidBodyType.Dynamic;
    go.addComponent(BoxCollider);

    stepN(10);

    expect(go.transform.position.y).toBeLessThan(5);
  });

  it("la realizzazione è deferita: il corpo Rapier non esiste prima del primo step()", () => {
    const go = new GameObject("cubo");
    const rb = go.addComponent(RigidBody);
    expect(rb._body).toBeNull();
    step(FIXED_DT);
    expect(rb._body).not.toBeNull();
  });

  it("un corpo fixed non si muove nonostante la gravità", () => {
    const go = new GameObject("suolo-rb");
    go.transform.setPosition(0, -1, 0);
    const rb = go.addComponent(RigidBody);
    rb.type = RigidBodyType.Fixed;
    go.addComponent(BoxCollider).size = { x: 20, y: 0.5, z: 20 };

    stepN(30);

    expect(go.transform.position.y).toBeCloseTo(-1);
  });
});

describe("Physics — Collider standalone (senza RigidBody) e collisione", () => {
  beforeEach(async () => {
    _resetPhysics();
    await initPhysics();
  });

  it("un cubo dynamic si appoggia su un piano rappresentato da un Collider standalone", () => {
    const ground = new GameObject("piano");
    ground.transform.setPosition(0, 0, 0);
    const groundCollider = ground.addComponent(BoxCollider);
    groundCollider.size = { x: 20, y: 0.4, z: 20 };

    const cube = new GameObject("cubo");
    cube.transform.setPosition(0, 3, 0);
    cube.addComponent(RigidBody);
    const cubeCollider = cube.addComponent(BoxCollider);
    cubeCollider.size = { x: 1, y: 1, z: 1 };
    cubeCollider.restitution = 0.3;

    // Abbastanza step da farlo cadere, rimbalzare e assestarsi.
    stepN(240);

    // Riposa sul piano: top del piano (y=0.2) + metà cubo (0.5) = 0.7, con margine.
    expect(cube.transform.position.y).toBeGreaterThan(0.6);
    expect(cube.transform.position.y).toBeLessThan(1.0);
  });

  it("un Collider aggiunto PRIMA del suo RigidBody si aggancia comunque correttamente (ordine irrilevante)", () => {
    const go = new GameObject("cubo-ordine-invertito");
    go.transform.setPosition(0, 5, 0);
    // Collider prima, RigidBody dopo — l'ordine inverso rispetto all'esempio precedente.
    go.addComponent(BoxCollider);
    go.addComponent(RigidBody);

    stepN(10);

    // Se l'aggancio fosse fallito (collider rimasto standalone alla vecchia posizione),
    // la Transform non si aggiornerebbe mai: verifichiamo che invece cada.
    expect(go.transform.position.y).toBeLessThan(5);
  });
});

describe("Physics.raycast", () => {
  beforeEach(async () => {
    _resetPhysics();
    await initPhysics();
  });

  it("colpisce un Collider e ne risale al componente proprietario", () => {
    const ground = new GameObject("piano");
    ground.transform.setPosition(0, 0, 0);
    const groundCollider = ground.addComponent(BoxCollider);
    groundCollider.size = { x: 20, y: 0.4, z: 20 };
    step(FIXED_DT); // realizza il collider

    const origin = ground.transform.position.clone().setY(5);
    const direction = new THREE.Vector3(0, -1, 0);
    const hit = raycast(origin, direction, 100);

    expect(hit).not.toBeNull();
    expect(hit!.collider).toBe(groundCollider);
    expect(hit!.distance).toBeCloseTo(4.8, 1);
  });

  it("ritorna null se non c'è nulla lungo il raggio", () => {
    const go = new GameObject("solo-nel-vuoto");
    go.addComponent(SphereCollider);
    step(FIXED_DT);

    const origin = go.transform.position.clone().setY(50);
    const direction = new THREE.Vector3(0, 1, 0);
    expect(raycast(origin, direction, 10)).toBeNull();
  });
});

describe("Physics — distruzione e cleanup", () => {
  beforeEach(async () => {
    _resetPhysics();
    await initPhysics();
  });

  it("distruggere prima il RigidBody e poi il Collider (stesso GameObject) non lancia (ordine A)", () => {
    const go = new GameObject("cubo");
    const rb = go.addComponent(RigidBody);
    const col = go.addComponent(BoxCollider);
    step(FIXED_DT);

    expect(() => {
      rb.onDestroy();
      col.onDestroy();
    }).not.toThrow();
  });

  it("distruggere prima il Collider e poi il RigidBody (stesso GameObject) non lancia (ordine B)", () => {
    const go = new GameObject("cubo");
    const rb = go.addComponent(RigidBody);
    const col = go.addComponent(BoxCollider);
    step(FIXED_DT);

    expect(() => {
      col.onDestroy();
      rb.onDestroy();
    }).not.toThrow();
  });
});

describe("Physics.setGravity", () => {
  beforeEach(async () => {
    _resetPhysics();
    await initPhysics();
  });

  it("un corpo dynamic con gravità azzerata non cade", () => {
    setGravity({ x: 0, y: 0, z: 0 });
    const go = new GameObject("cubo-senza-gravita");
    go.transform.setPosition(0, 5, 0);
    go.addComponent(RigidBody);
    go.addComponent(BoxCollider);

    stepN(30);

    expect(go.transform.position.y).toBeCloseTo(5, 3);
  });
});
