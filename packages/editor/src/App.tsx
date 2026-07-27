import { Hierarchy } from "./panels/Hierarchy.js";
import { Viewport } from "./panels/Viewport.js";
import { Inspector } from "./panels/Inspector.js";
import { Topbar } from "./panels/Topbar.js";
import { AssetsPanel } from "./panels/AssetsPanel.js";
import { HostAgentPanel } from "./panels/HostAgentPanel.js";
import { PwaUpdateBanner } from "./PwaUpdateBanner.js";
import "./App.css";

export function App(): JSX.Element {
  return (
    <div className="editor-shell">
      <Topbar />
      <PwaUpdateBanner />
      <main className="editor-body">
        <Hierarchy />
        <Viewport />
        <Inspector />
      </main>
      {/* Fase 7 — riga a piena larghezza sotto i tre pannelli principali, non quarta colonna: vedi JSDoc di AssetsPanel.tsx. */}
      <AssetsPanel />
      <HostAgentPanel />
    </div>
  );
}
