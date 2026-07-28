import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOUSE } from "three";
import type { PerspectiveCamera, Vector3 } from "three";

/**
 * OrbitCameraController — camera controller "base" richiesto dalla Fase 2.
 *
 * Wrapper sottile attorno a `OrbitControls` (addon ufficiale three.js):
 * non reinventa la matematica di orbit/pan/zoom, si limita a esporre
 * un'API minimale e prevedibile (`update(dt)` / `dispose()`) pensata per
 * essere chiamata dentro al callback `onRenderFrame` dell'Engine, dove
 * gira già ogni altro aggiornamento per-frame del motore.
 *
 * Non è un Component: OrbitControls manipola direttamente `camera.position`
 * / `camera.quaternion` in risposta a eventi di puntamento sul DOM, non
 * tramite il Transform di un GameObject — mAppiarlo a un Component
 * richiederebbe che GameObject potesse avvolgere una Camera già esistente,
 * cosa che l'attuale GameObject (Fase 1) non supporta. Riconsiderare in
 * una fase futura se servirà un GameObject "camera-aware".
 */
export class OrbitCameraController {
  private readonly controls: OrbitControls;

  constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 100;
  }

  /** Punto attorno a cui orbita la camera. */
  get target(): Vector3 {
    return this.controls.target;
  }

  /**
   * Se `false`, i controlli non rispondono più all'input utente (drag/wheel
   * restano collegati al DOM ma non hanno effetto — delega diretta a
   * `OrbitControls.enabled`, nativo dell'addon, nessuno stato duplicato qui).
   * Serve all'editor (Fase 4C) per disattivare l'orbit mentre si trascina il
   * gizmo di trasformazione nel Viewport: altrimenti i due controlli si
   * contenderebbero lo stesso drag sul canvas (l'orbit ruoterebbe la camera
   * mentre il gizmo tenta di muovere l'oggetto selezionato).
   */
  get enabled(): boolean {
    return this.controls.enabled;
  }

  set enabled(value: boolean) {
    this.controls.enabled = value;
  }

  /** Sposta il punto di orbita e aggiorna subito i controlli. */
  setTarget(x: number, y: number, z: number): void {
    this.controls.target.set(x, y, z);
    this.controls.update();
  }

  /**
   * Fase 8B — abilita/disabilita l'orbit sul drag del tasto sinistro del
   * mouse: quando `false`, il tasto sinistro non ha alcuna azione mappata
   * (`mouseButtons.LEFT = null`), il tasto destro (pan) e la rotellina
   * (zoom) restano sempre attivi indipendentemente da questo flag — solo
   * la ROTATE sul tasto sinistro è condizionata. Pensato per l'editor
   * (createEditorScene.ts), che tiene questo `false` di default e lo
   * abilita solo mentre Alt è premuto (stile Unity: Alt+drag sinistro per
   * orbitare, tasto sinistro libero per il click di selezione) — nessun
   * consumer generico di questa classe (es. apps/playground) è tenuto ad
   * usarlo, resta `true`/orbit-su-drag-semplice di default finché non
   * viene chiamato esplicitamente.
   */
  setLeftMouseRotateEnabled(enabled: boolean): void {
    this.controls.mouseButtons.LEFT = enabled ? MOUSE.ROTATE : null;
  }

  /**
   * Da chiamare una volta per frame (richiesto dal damping). `dt` non è
   * usato dalla matematica di OrbitControls (che non è time-based) ma è
   * accettato per coerenza con la firma `onRenderFrame(dt)` dell'Engine.
   */
  update(_dt?: number): void {
    this.controls.update();
  }

  /** Rimuove i listener DOM registrati da OrbitControls. Chiamare su teardown/hot-reload. */
  dispose(): void {
    this.controls.dispose();
  }
}
