/**
 * Inspector — placeholder di layout per la Fase 4A.
 *
 * I campi Transform editabili (position/rotation/scale) sincronizzati col
 * gizmo nel Viewport arrivano in Fase 4C, una volta che la selezione
 * (Fase 4B) esiste davvero.
 */
export function Inspector(): JSX.Element {
  return (
    <div className="panel side-panel">
      <h2 className="panel-title">Inspector</h2>
      <p className="panel-placeholder">Proprietà dell'oggetto selezionato — Fase 4C.</p>
    </div>
  );
}
