import { Hierarchy } from "./panels/Hierarchy.js";
import { Viewport } from "./panels/Viewport.js";
import { Inspector } from "./panels/Inspector.js";
import { PwaUpdateBanner } from "./PwaUpdateBanner.js";
import "./App.css";

export function App(): JSX.Element {
  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <span className="editor-topbar-title">Engine Editor</span>
      </header>
      <PwaUpdateBanner />
      <main className="editor-body">
        <Hierarchy />
        <Viewport />
        <Inspector />
      </main>
    </div>
  );
}
