/**
 * Hierarchy — placeholder di layout per la Fase 4A.
 *
 * L'albero reale dei GameObject (derivato camminando la scene graph
 * three.js, click-to-select sincronizzato col Viewport/Inspector) arriva
 * in Fase 4B. Qui serve solo a stabilizzare il layout a tre pannelli e le
 * relative dimensioni/scroll prima di introdurre stato condiviso.
 */
export function Hierarchy(): JSX.Element {
  return (
    <div className="panel side-panel">
      <h2 className="panel-title">Hierarchy</h2>
      <p className="panel-placeholder">Albero dei GameObject — Fase 4B.</p>
    </div>
  );
}
