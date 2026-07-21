import { useEffect, useRef } from "react";
import type { ChangeEvent } from "react";
import { selectionStore, transformVersionStore, bumpTransformVersion } from "../store/editorStore.js";
import { radToDeg, degToRad, roundForDisplay, parseNumericInput } from "./transformFields.js";

/**
 * Inspector — proprietà Transform del GameObject selezionato (Fase 4C).
 *
 * Legge `selectionStore` (Fase 4B, come Hierarchy.tsx) e in più
 * `transformVersionStore`: quest'ultimo esiste solo perché
 * Transform.position/eulerAngles/localScale sono istanze THREE.Vector3/
 * Euler mutate in place — un drag del gizmo nel Viewport (vedi
 * createEditorScene.ts) le modifica senza generare da sé alcun re-render
 * React, quindi questo componente si sottoscrive esplicitamente al
 * contatore per sapere quando ridisegnarsi con i valori aggiornati.
 * `transformVersionStore.useValue()` non serve al valore restituito, solo
 * a re-renderizzare: la fonte di verità dei numeri mostrati resta sempre e
 * solo `selected.transform`, letto direttamente ad ogni render.
 *
 * Rotazione mostrata in gradi (convenzione più leggibile per un umano che
 * digita in un campo Inspector), convertita da/verso i radianti di
 * `Transform.eulerAngles` (fonte di verità interna) solo ai bordi di
 * lettura/scrittura — vedi scene/transformFields.ts.
 *
 * Ogni campo numerico (`NumberField` sotto) è un input non completamente
 * controllato: mantiene il proprio valore DOM e lo risincronizza da
 * `value` tramite un effect, ma SALTA la risincronizzazione se l'input ha
 * il focus. Senza questa guardia, un aggiornamento esterno arrivato mentre
 * l'utente sta ancora digitando (es. un bump di transformVersionStore
 * generato dal proprio stesso commit, oppure un drag del gizmo su un altro
 * asse mentre questo campo è a metà digitazione) sovrascriverebbe quello
 * che l'utente sta scrivendo — comportamento comune per campi numerici
 * bidirezionali sincronizzati con uno stato esterno mutabile.
 */
export function Inspector(): JSX.Element {
  const selected = selectionStore.useValue();
  transformVersionStore.useValue();

  if (!selected) {
    return (
      <div className="panel side-panel">
        <h2 className="panel-title">Inspector</h2>
        <p className="panel-placeholder">Nessuna selezione.</p>
      </div>
    );
  }

  const { transform } = selected;
  const position = transform.position;
  const rotation = transform.eulerAngles;
  const scale = transform.localScale;

  function commitPosition(axis: "x" | "y" | "z", value: number): void {
    const p = transform.position;
    transform.setPosition(
      axis === "x" ? value : p.x,
      axis === "y" ? value : p.y,
      axis === "z" ? value : p.z
    );
    bumpTransformVersion();
  }

  function commitRotationDegrees(axis: "x" | "y" | "z", degrees: number): void {
    const r = transform.eulerAngles;
    const radians = degToRad(degrees);
    transform.setEulerAngles(
      axis === "x" ? radians : r.x,
      axis === "y" ? radians : r.y,
      axis === "z" ? radians : r.z
    );
    bumpTransformVersion();
  }

  function commitScale(axis: "x" | "y" | "z", value: number): void {
    const s = transform.localScale;
    transform.setLocalScale(
      axis === "x" ? value : s.x,
      axis === "y" ? value : s.y,
      axis === "z" ? value : s.z
    );
    bumpTransformVersion();
  }

  return (
    <div className="panel side-panel">
      <h2 className="panel-title">Inspector</h2>
      <p className="inspector-object-name">{selected.name}</p>
      <Vector3Row title="Position" x={position.x} y={position.y} z={position.z} onChangeAxis={commitPosition} />
      <Vector3Row
        title="Rotation"
        x={radToDeg(rotation.x)}
        y={radToDeg(rotation.y)}
        z={radToDeg(rotation.z)}
        onChangeAxis={commitRotationDegrees}
      />
      <Vector3Row title="Scale" x={scale.x} y={scale.y} z={scale.z} onChangeAxis={commitScale} />
    </div>
  );
}

function Vector3Row({
  title,
  x,
  y,
  z,
  onChangeAxis,
}: {
  title: string;
  x: number;
  y: number;
  z: number;
  onChangeAxis: (axis: "x" | "y" | "z", value: number) => void;
}): JSX.Element {
  return (
    <div className="inspector-row">
      <span className="inspector-row-title">{title}</span>
      <div className="inspector-row-fields">
        <NumberField label="X" value={x} onCommit={(next) => onChangeAxis("x", next)} />
        <NumberField label="Y" value={y} onCommit={(next) => onChangeAxis("y", next)} />
        <NumberField label="Z" value={z} onCommit={(next) => onChangeAxis("z", next)} />
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // Non sovrascrivere il campo mentre l'utente lo sta digitando — vedi
    // il commento del componente Inspector qui sopra.
    if (document.activeElement === input) return;
    input.value = String(roundForDisplay(value));
  }, [value]);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const parsed = parseNumericInput(event.target.value);
    // Stati intermedi di digitazione ("-", "1.", campo vuoto) non
    // producono ancora un numero valido: li lasciamo nell'input senza
    // scrivere sul Transform, invece di forzare un valore a metà digitato.
    if (parsed !== null) onCommit(parsed);
  }

  return (
    <label className="inspector-field">
      <span className="inspector-field-label">{label}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        defaultValue={String(roundForDisplay(value))}
        onChange={handleChange}
        className="inspector-field-input"
      />
    </label>
  );
}
