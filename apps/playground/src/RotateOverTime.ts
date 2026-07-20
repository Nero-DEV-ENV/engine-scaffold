import { Component } from "@engine/core";

/**
 * RotateOverTime — componente demo per la Fase 1: ruota il GameObject
 * attorno all'asse Y a una velocità costante in radianti/secondo,
 * usando Time.deltaTime tramite il parametro passato a update(). Serve
 * a dimostrare end-to-end che Component/GameObject/Transform/Engine
 * lavorano insieme correttamente.
 */
export class RotateOverTime extends Component {
  /** Velocità di rotazione in radianti al secondo. */
  speed = 1;

  override update(dt: number): void {
    this.transform.rotate(0, this.speed * dt, 0);
  }
}
