import { Component } from "@engine/core";

/**
 * RotateOverTime — componente demo, ereditato dalla Fase 1: ruota il
 * GameObject attorno all'asse Y a velocità costante. In Fase 2 è
 * declassato a fallback: se il caricamento del modello GLTF fallisce
 * (es. rete assente), il playground mostra questo cubo rotante al posto
 * di una scena vuota, così il problema è visibile invece che silenzioso.
 */
export class RotateOverTime extends Component {
  /** Velocità di rotazione in radianti al secondo. */
  speed = 1;

  override update(dt: number): void {
    this.transform.rotate(0, this.speed * dt, 0);
  }
}
