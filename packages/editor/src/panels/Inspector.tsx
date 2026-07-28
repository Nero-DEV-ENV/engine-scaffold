import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  selectionStore,
  transformVersionStore,
  bumpTransformVersion,
  editorSceneHandleStore,
} from "../store/editorStore.js";
import { radToDeg, degToRad, roundForDisplay, parseNumericInput } from "./transformFields.js";
import { Component, serializeComponent, RigidBodyType } from "@engine/core";
import type { ComponentData, ComponentTypeName, GameObject } from "@engine/core";
import type { EditorSceneHandle } from "../scene/createEditorScene.js";
import { PlusIcon, RemoveIcon } from "../icons.js";

/**
 * Fase 6D — un componente per l'Inspector: opzioni del menu "Aggiungi
 * componente" (solo i tipi NON ancora presenti sul GameObject selezionato,
 * filtrati in `ComponentsSection` sotto) e i valori di default con cui
 * viene creato, allineati ESATTAMENTE ai default reali del motore
 * (`DEFAULT_SHAPE`/`DEFAULT_COLOR` in MeshRenderer.ts, `DEFAULT_KIND`/
 * `DEFAULT_COLOR`/`DEFAULT_INTENSITY` in Light.ts, il default di
 * `RigidBody.type`/`gravityScale`, i default di classe di Collider.ts) —
 * verificati sul codice reale, non inventati.
 */
const COMPONENT_OPTIONS: ReadonlyArray<{ type: ComponentTypeName; label: string }> = [
  { type: "MeshRenderer", label: "Mesh Renderer" },
  { type: "Light", label: "Light" },
  { type: "RigidBody", label: "Rigid Body" },
  { type: "BoxCollider", label: "Box Collider" },
  { type: "SphereCollider", label: "Sphere Collider" },
];

function defaultComponentData(type: ComponentTypeName): ComponentData {
  switch (type) {
    case "MeshRenderer":
      return { type: "MeshRenderer", shape: { kind: "box", size: { x: 1, y: 1, z: 1 } }, color: 0xffffff };
    case "Light":
      return { type: "Light", lightKind: { kind: "ambient" }, color: 0xffffff, intensity: 1 };
    case "RigidBody":
      return { type: "RigidBody", bodyType: RigidBodyType.Dynamic, gravityScale: 1 };
    case "BoxCollider":
      return { type: "BoxCollider", size: { x: 1, y: 1, z: 1 }, friction: 0.5, restitution: 0, isTrigger: false };
    case "SphereCollider":
      return { type: "SphereCollider", radius: 0.5, friction: 0.5, restitution: 0, isTrigger: false };
  }
}

/** Fase 6D — MeshRenderer.color/Light.color sono un numero (0xRRGGBB, convenzione three.js), <input type="color"> vuole una stringa "#rrggbb". */
function colorNumberToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function hexToColorNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

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
 *
 * Fase 6C.1: bottone "Elimina" accanto al nome dell'oggetto, visibile solo
 * quando c'è una selezione (coerente col resto del componente, che già
 * ritorna presto se `selected` è null). Chiama
 * `EditorSceneHandle.removeGameObject` (createEditorScene.ts) — resettare
 * `selectionStore` a `null` non serve qui: lo fa già `removeGameObject`
 * stesso quando l'oggetto rimosso è quello selezionato, che è sempre il
 * caso da questo bottone. Sync di rete arrivato in 6C.2.
 *
 * Fase 6D aggiunge la sezione "Components" sotto Scale
 * (`ComponentsSection` sotto): elenco dei componenti presenti
 * (`selected.getComponents(Component)`, API pubblica esistente — accetta
 * la classe base astratta, verificato sul codice reale di
 * core/Component.ts) con campi editabili per tipo, bottone "+" con lo
 * stesso pattern menu di Hierarchy.tsx (solo i tipi non ancora presenti),
 * bottone "Rimuovi" per componente. `shape`/`lightKind` (MeshRenderer/
 * Light) mostrati in sola lettura: sono a loro volta union discriminate
 * annidate, editarle è fuori scope per questa fase (deciso con l'utente).
 */
export function Inspector(): JSX.Element {
  const selected = selectionStore.useValue();
  const handle = editorSceneHandleStore.useValue();
  transformVersionStore.useValue();

  if (!selected) {
    return (
      <div className="panel side-panel inspector-panel">
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

  // Cattura `selected` (già narrowed a `GameObject` dal return precoce
  // sopra) in una const separata: TypeScript non propaga il narrowing di
  // una variabile esterna dentro una `function` annidata come `onDelete`
  // sotto — stesso motivo per cui `const { transform } = selected` sopra
  // esiste già, verificato dal typecheck reale (non assunto).
  const selectedGameObject = selected;

  function onDelete(): void {
    if (!handle) return;
    handle.removeGameObject(selectedGameObject);
  }

  return (
    <div className="panel side-panel inspector-panel">
      <h2 className="panel-title">Inspector</h2>
      <div className="inspector-header">
        <p className="inspector-object-name">{selected.name}</p>
        <button
          type="button"
          className="inspector-delete-button"
          disabled={!handle}
          onClick={onDelete}
          aria-label={`Elimina ${selected.name}`}
          title="Elimina"
        >
          <RemoveIcon />
        </button>
      </div>
      <Vector3Row title="Position" x={position.x} y={position.y} z={position.z} onChangeAxis={commitPosition} />
      <Vector3Row
        title="Rotation"
        x={radToDeg(rotation.x)}
        y={radToDeg(rotation.y)}
        z={radToDeg(rotation.z)}
        onChangeAxis={commitRotationDegrees}
      />
      <Vector3Row title="Scale" x={scale.x} y={scale.y} z={scale.z} onChangeAxis={commitScale} />
      <ComponentsSection gameObject={selectedGameObject} handle={handle} />
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

/**
 * Fase 6D — sezione "Components" dell'Inspector: elenco dei componenti
 * presenti su `gameObject` + bottone "+" (stesso pattern menu di
 * `hierarchy-add`/`hierarchy-add-menu` in Hierarchy.tsx, solo i tipi NON
 * ancora presenti — mirror del vincolo di `GameObject.addComponent` nel
 * motore, che impedisce comunque il duplicato anche se l'utente riuscisse
 * a cliccare un tipo già presente).
 */
function ComponentsSection({
  gameObject,
  handle,
}: {
  gameObject: GameObject;
  handle: EditorSceneHandle | null;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const components = gameObject.getComponents(Component);
  const presentTypes = new Set(
    components.map((c) => serializeComponent(c)?.type).filter((t): t is ComponentTypeName => t !== undefined),
  );
  const availableOptions = COMPONENT_OPTIONS.filter((option) => !presentTypes.has(option.type));

  function onAdd(type: ComponentTypeName): void {
    if (!handle) return;
    handle.addComponent(gameObject, defaultComponentData(type));
    setMenuOpen(false);
  }

  return (
    <div className="inspector-components">
      <div className="inspector-components-header">
        <span className="inspector-row-title">Components</span>
        <div className="hierarchy-add" ref={menuRef}>
          <button
            type="button"
            className="hierarchy-add-button"
            disabled={!handle || availableOptions.length === 0}
            aria-label="Aggiungi componente"
            title="Aggiungi componente"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <PlusIcon />
          </button>
          {menuOpen && (
            <ul className="hierarchy-add-menu">
              {availableOptions.map((option) => (
                <li key={option.type}>
                  <button type="button" className="hierarchy-add-option" onClick={() => onAdd(option.type)}>
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {components.length === 0 ? (
        <p className="panel-placeholder">Nessun componente.</p>
      ) : (
        components.map((component) => (
          <ComponentRow key={component.constructor.name} gameObject={gameObject} component={component} handle={handle} />
        ))
      )}
    </div>
  );
}

/** Fase 6D — una riga della sezione Components: titolo + campi editabili per tipo (`ComponentFields` sotto) + bottone "Rimuovi". */
function ComponentRow({
  gameObject,
  component,
  handle,
}: {
  gameObject: GameObject;
  component: Component;
  handle: EditorSceneHandle | null;
}): JSX.Element | null {
  const data = serializeComponent(component);
  // Non dovrebbe mai accadere per i 5 tipi gestiti da Inspector — difesa
  // se in futuro un componente non serializzabile venisse aggiunto al
  // motore senza che questo pannello venga aggiornato di pari passo.
  if (!data) return null;
  // Cattura `data` (già narrowed a non-null sopra) in una const separata:
  // stesso motivo di `selectedGameObject` nel componente Inspector —
  // TypeScript non propaga il narrowing dentro le function annidate sotto.
  const componentData = data;

  function commit(next: ComponentData): void {
    if (!handle) return;
    handle.updateComponent(gameObject, next);
  }

  function onRemove(): void {
    if (!handle) return;
    handle.removeComponent(gameObject, componentData.type);
  }

  // Fase 9 — estratto in una const: prima calcolato inline solo nello
  // <span> del titolo, ora serve anche nell'aria-label del bottone "×"
  // (che ha sostituito il testo visibile "Rimuovi").
  const componentLabel = COMPONENT_OPTIONS.find((option) => option.type === componentData.type)?.label ?? componentData.type;

  return (
    <div className="inspector-component">
      <div className="inspector-component-header">
        <span className="inspector-component-title">{componentLabel}</span>
        <button
          type="button"
          className="inspector-delete-button"
          disabled={!handle}
          onClick={onRemove}
          aria-label={`Rimuovi ${componentLabel}`}
          title="Rimuovi"
        >
          <RemoveIcon />
        </button>
      </div>
      <ComponentFields data={componentData} onCommit={commit} />
    </div>
  );
}

const RIGID_BODY_TYPE_OPTIONS: ReadonlyArray<{ value: RigidBodyType; label: string }> = [
  { value: RigidBodyType.Dynamic, label: "Dynamic" },
  { value: RigidBodyType.Kinematic, label: "Kinematic" },
  { value: RigidBodyType.Fixed, label: "Fixed" },
];

/**
 * Fase 6D — campi editabili specifici per `data.type`. `shape`/`lightKind`
 * (MeshRenderer/Light) sono union discriminate annidate, mostrate in sola
 * lettura (decisione confermata con l'utente, vedi JSDoc di Inspector
 * sopra) invece di un secondo switch esaustivo dentro la UI.
 */
function ComponentFields({ data, onCommit }: { data: ComponentData; onCommit: (next: ComponentData) => void }): JSX.Element {
  switch (data.type) {
    case "MeshRenderer":
      return (
        <>
          <p className="inspector-component-readonly">Shape: {data.shape.kind}</p>
          <label className="inspector-field">
            <span className="inspector-field-label">Color</span>
            <input
              type="color"
              value={colorNumberToHex(data.color)}
              onChange={(event) => onCommit({ ...data, color: hexToColorNumber(event.target.value) })}
              className="inspector-color-input"
            />
          </label>
        </>
      );
    case "Light":
      return (
        <>
          <p className="inspector-component-readonly">Kind: {data.lightKind.kind}</p>
          <label className="inspector-field">
            <span className="inspector-field-label">Color</span>
            <input
              type="color"
              value={colorNumberToHex(data.color)}
              onChange={(event) => onCommit({ ...data, color: hexToColorNumber(event.target.value) })}
              className="inspector-color-input"
            />
          </label>
          <NumberField label="Intensity" value={data.intensity} onCommit={(next) => onCommit({ ...data, intensity: next })} />
        </>
      );
    case "RigidBody":
      return (
        <>
          <SelectField
            label="Body Type"
            value={data.bodyType}
            options={RIGID_BODY_TYPE_OPTIONS}
            onCommit={(next) => onCommit({ ...data, bodyType: next })}
          />
          <NumberField
            label="Gravity Scale"
            value={data.gravityScale}
            onCommit={(next) => onCommit({ ...data, gravityScale: next })}
          />
        </>
      );
    case "BoxCollider":
      return (
        <>
          <Vector3Row
            title="Size"
            x={data.size.x}
            y={data.size.y}
            z={data.size.z}
            onChangeAxis={(axis, value) => onCommit({ ...data, size: { ...data.size, [axis]: value } })}
          />
          <NumberField label="Friction" value={data.friction} onCommit={(next) => onCommit({ ...data, friction: next })} />
          <NumberField
            label="Restitution"
            value={data.restitution}
            onCommit={(next) => onCommit({ ...data, restitution: next })}
          />
          <BooleanField label="Is Trigger" checked={data.isTrigger} onCommit={(next) => onCommit({ ...data, isTrigger: next })} />
        </>
      );
    case "SphereCollider":
      return (
        <>
          <NumberField label="Radius" value={data.radius} onCommit={(next) => onCommit({ ...data, radius: next })} />
          <NumberField label="Friction" value={data.friction} onCommit={(next) => onCommit({ ...data, friction: next })} />
          <NumberField
            label="Restitution"
            value={data.restitution}
            onCommit={(next) => onCommit({ ...data, restitution: next })}
          />
          <BooleanField label="Is Trigger" checked={data.isTrigger} onCommit={(next) => onCommit({ ...data, isTrigger: next })} />
        </>
      );
  }
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onCommit: (next: T) => void;
}): JSX.Element {
  return (
    <label className="inspector-field inspector-select-field">
      <span className="inspector-field-label">{label}</span>
      <select className="inspector-select-input" value={value} onChange={(event) => onCommit(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function BooleanField({
  label,
  checked,
  onCommit,
}: {
  label: string;
  checked: boolean;
  onCommit: (next: boolean) => void;
}): JSX.Element {
  return (
    <label className="inspector-field inspector-checkbox-field">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCommit(event.target.checked)}
        className="inspector-checkbox-input"
      />
      <span className="inspector-field-label">{label}</span>
    </label>
  );
}
