import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// Niente <React.StrictMode> attorno ad <App />: il registry dei GameObject
// vivi in packages/core/src/core/Scene.ts è un Set a livello di MODULO
// (non scoped per istanza — verificato leggendo Scene.ts), quindi il doppio
// mount/unmount/mount sincrono che StrictMode fa in sviluppo aprirebbe una
// finestra in cui due bootstrap della scena potrebbero accavallarsi sullo
// stesso registry globale. Il Viewport gestisce comunque da solo la
// cancellazione di un bootstrap async in corso (vedi il flag `cancelled` in
// Viewport.tsx) per restare corretto sotto fast-refresh di Vite, che può
// innescare lo stesso pattern mount→unmount→mount.
const container = document.getElementById("root");
if (!container) {
  throw new Error("main.tsx: elemento #root non trovato in index.html");
}

createRoot(container).render(<App />);
