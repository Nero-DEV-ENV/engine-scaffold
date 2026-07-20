import { describe, it, expect, beforeEach } from "vitest";
import {
  Engine,
  GameObject,
  Instantiate,
  Destroy,
  Component,
  Time,
} from "./index.js";

class SpyComponent extends Component {
  awakeCalls = 0;
  startCalls = 0;
  updateCalls: number[] = [];
  destroyCalls = 0;

  override awake(): void {
    this.awakeCalls++;
  }

  override start(): void {
    this.startCalls++;
  }

  override update(dt: number): void {
    this.updateCalls.push(dt);
  }

  override onDestroy(): void {
    this.destroyCalls++;
  }
}

describe("GameObject / Component", () => {
  beforeEach(() => {
    Engine._resetAll();
  });

  it("addComponent chiama awake() immediatamente", () => {
    const go = new GameObject("test");
    const comp = go.addComponent(SpyComponent);
    expect(comp.awakeCalls).toBe(1);
    expect(comp.gameObject).toBe(go);
  });

  it("getComponent trova il componente per tipo, null se assente", () => {
    const go = new GameObject("test");
    expect(go.getComponent(SpyComponent)).toBeNull();
    const comp = go.addComponent(SpyComponent);
    expect(go.getComponent(SpyComponent)).toBe(comp);
  });

  it("rifiuta due componenti dello stesso tipo sullo stesso GameObject", () => {
    const go = new GameObject("test");
    go.addComponent(SpyComponent);
    expect(() => go.addComponent(SpyComponent)).toThrow();
  });

  it("il Transform è sempre presente e agisce sull'Object3D sottostante", () => {
    const go = new GameObject("test");
    go.transform.setPosition(1, 2, 3);
    expect(go._object3D.position.x).toBe(1);
    expect(go._object3D.position.y).toBe(2);
    expect(go._object3D.position.z).toBe(3);
  });

  it("setParent riparent-a l'Object3D sottostante", () => {
    const parent = new GameObject("parent");
    const child = new GameObject("child");
    child.transform.setParent(parent.transform);
    expect(child._object3D.parent).toBe(parent._object3D);
  });
});

describe("Engine game loop", () => {
  beforeEach(() => {
    Engine._resetAll();
  });

  it("chiama start() una sola volta, prima del primo update()", () => {
    const go = new GameObject("test");
    const comp = go.addComponent(SpyComponent);
    const engine = new Engine();

    engine.step(1 / 60);
    engine.step(1 / 60);

    expect(comp.startCalls).toBe(1);
    expect(comp.updateCalls.length).toBe(2);
  });

  it("update() riceve il deltaTime reale del frame (variable timestep)", () => {
    const go = new GameObject("test");
    const comp = go.addComponent(SpyComponent);
    const engine = new Engine();

    engine.step(0.05);
    engine.step(0.016);

    expect(comp.updateCalls).toEqual([0.05, 0.016]);
    expect(Time.deltaTime).toBeCloseTo(0.016);
  });

  it("Destroy() rimanda onDestroy() e la rimozione a fine frame", () => {
    const go = new GameObject("test");
    const comp = go.addComponent(SpyComponent);
    const engine = new Engine();

    Destroy(go);
    // onDestroy non ancora chiamato: la distruzione è pending fino al flush.
    expect(comp.destroyCalls).toBe(0);

    engine.step(1 / 60);
    expect(comp.destroyCalls).toBe(1);

    // Un GameObject distrutto non riceve più update nei frame successivi.
    comp.updateCalls = [];
    engine.step(1 / 60);
    expect(comp.updateCalls.length).toBe(0);
  });

  it("Instantiate crea un GameObject registrato nel loop", () => {
    const go = Instantiate("spawned");
    const comp = go.addComponent(SpyComponent);
    const engine = new Engine();

    engine.step(1 / 60);
    expect(comp.updateCalls.length).toBe(1);
  });

  it("un GameObject inattivo non riceve update()", () => {
    const go = new GameObject("test");
    const comp = go.addComponent(SpyComponent);
    go.setActive(false);
    const engine = new Engine();

    engine.step(1 / 60);
    expect(comp.updateCalls.length).toBe(0);
  });
});
