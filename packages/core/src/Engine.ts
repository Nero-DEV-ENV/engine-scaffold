import { Time } from "./Time.js";
import { _getLiveGameObjects, _flushPendingDestroys, _resetScene } from "./core/Scene.js";

/**
 * Engine — game loop principale, guidato da `requestAnimationFrame`.
 *
 * Implementa un accumulator pattern classico (fixed + variable
 * timestep): ad ogni rAF calcola il delta reale, lo accumula, e
 * consuma l'accumulatore a passi fissi di `Time.fixedDeltaTime` per
 * `fixedUpdate` (usato dalla fisica in Fase 3 — per ora nessun
 * componente lo implementa ancora, ma il loop è già pronto). Il
 * variable-timestep `update` gira invece una volta per frame con il
 * delta reale, non quantizzato: è quello giusto per input, animazioni
 * e — nel deliverable di questa fase — la rotazione del cubo.
 *
 * Ordine per frame:
 *   1. accumulator += realDeltaTime (clampato per evitare "spiral of death")
 *   2. while (accumulator >= fixedDeltaTime): fixedUpdate, accumulator -= fixedDeltaTime
 *   3. awake() è già stato chiamato da addComponent(); qui chiamiamo
 *      start() una tantum per i componenti nuovi, poi update(dt)
 *   4. flush dei GameObject marcati con Destroy()
 */
export class Engine {
  private _running = false;
  private _rafHandle: number | null = null;
  private _lastTimestamp: number | null = null;
  private _accumulator = 0;

  /** Limite di sicurezza sul delta di un singolo frame (es. tab in background). */
  private static readonly MAX_FRAME_DELTA = 0.25;

  private readonly _onRenderFrame: (dt: number) => void;

  /**
   * @param onRenderFrame Callback invocata una volta per frame variabile,
   *   dopo update() dei componenti e prima del flush dei Destroy — tipicamente
   *   qui il chiamante fa `renderer.render(scene, camera)`.
   */
  constructor(onRenderFrame: (dt: number) => void = () => {}) {
    this._onRenderFrame = onRenderFrame;
  }

  get running(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._lastTimestamp = null;
    this._accumulator = 0;
    this._rafHandle = requestAnimationFrame(this._tick);
  }

  stop(): void {
    this._running = false;
    if (this._rafHandle !== null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  /** @internal — reset completo, usato nei test e tra run del playground. */
  static _resetAll(): void {
    Time._reset();
    _resetScene();
  }

  private _tick = (timestampMs: number): void => {
    if (!this._running) return;

    const timestampSec = timestampMs / 1000;
    const rawDelta =
      this._lastTimestamp === null ? 0 : timestampSec - this._lastTimestamp;
    this._lastTimestamp = timestampSec;

    // Clamp per evitare che un frame anomalo (tab in background, breakpoint
    // debugger) generi centinaia di fixedUpdate consecutivi al risveglio.
    const realDelta = Math.min(rawDelta, Engine.MAX_FRAME_DELTA);

    this.step(realDelta);

    this._rafHandle = requestAnimationFrame(this._tick);
  };

  /**
   * Esegue un singolo frame del loop con il delta dato. Esposto come
   * metodo pubblico (non solo tramite rAF) così i test possono avanzare
   * il loop deterministicamente senza dipendere dal timer del browser.
   */
  step(realDelta: number): void {
    Time._advance(realDelta);
    this._accumulator += realDelta;

    const fixedDt = Time.fixedDeltaTime;
    while (this._accumulator >= fixedDt) {
      this._runFixedUpdate(fixedDt);
      this._accumulator -= fixedDt;
    }

    this._runStartAndUpdate(Time.deltaTime);
    this._onRenderFrame(Time.deltaTime);
    _flushPendingDestroys();
  }

  private _runFixedUpdate(fixedDt: number): void {
    for (const go of _getLiveGameObjects()) {
      if (!go.active || go._destroyed) continue;
      for (const component of go._getAllComponents()) {
        if (component._destroyed) continue;
        component.fixedUpdate?.(fixedDt);
      }
    }
  }

  private _runStartAndUpdate(dt: number): void {
    for (const go of _getLiveGameObjects()) {
      if (!go.active || go._destroyed) continue;
      for (const component of go._getAllComponents()) {
        if (component._destroyed) continue;
        if (!component._started) {
          component._started = true;
          component.start();
        }
      }
    }
    for (const go of _getLiveGameObjects()) {
      if (!go.active || go._destroyed) continue;
      for (const component of go._getAllComponents()) {
        if (component._destroyed) continue;
        component.update(dt);
      }
    }
  }
}
