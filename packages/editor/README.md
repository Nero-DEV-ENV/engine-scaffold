# editor

Editor visuale del motore, React 18 + Vite, installabile come PWA.

## Funzionalità (Fase 4A–4D)

- Layout a tre pannelli (Hierarchy | Viewport | Inspector) via CSS grid
- Viewport: bootstrap di `Engine`/`GameObject`/`createRenderer`/
  `OrbitCameraController`/`createBasicLighting` da `@engine/core`, scena demo
  (Ground + Cube + Sphere + luci), orbit camera, resize via `ResizeObserver`
  sul pannello (non `attachAutoResize`, pensato per canvas a piena finestra)
- Hierarchy: albero reale dei GameObject della scena corrente, selezione
  sincronizzata con il Viewport (click su una riga o raycast sul canvas)
- Inspector: campi Position/Rotation(gradi)/Scale editabili per il GameObject
  selezionato, sincronizzati bidirezionalmente con il gizmo `TransformControls`
  nel Viewport
- PWA installabile: manifest + service worker (Workbox, strategia
  `generateSW`) generati automaticamente dalla build di produzione

## Sviluppo

```bash
pnpm dev:editor
```

Il server di sviluppo NON registra un service worker (solo la build di
produzione lo fa): durante `pnpm dev:editor` l'editor si comporta come
una normale SPA, senza cache offline.

## Build di produzione e installazione PWA

```bash
pnpm --filter editor build
pnpm --filter editor preview   # per servire dist/ e testare l'installazione
```

Dopo `pnpm --filter editor build`, `dist/` contiene, oltre ai normali asset
Vite:

- `manifest.webmanifest` — nome, icone, `theme_color`/`background_color`
  coerenti col tema scuro dell'editor
- `sw.js` — service worker generato da Workbox (precache di tutti gli asset
  statici della build: JS/CSS/HTML/icone)
- `registerSW.js` — script di registrazione iniettato in `dist/index.html`

Aprendo la build servita (es. `pnpm --filter editor preview`) in Chrome/Edge,
l'icona di installazione compare nella barra degli indirizzi; su mobile,
"Aggiungi a schermata Home". Dopo la prima visita online, l'editor resta
avviabile anche offline (asset precachati da Workbox) — verificabile
disattivando la rete dai DevTools e ricaricando la pagina.

`registerType` è impostato su `"prompt"` (non `"autoUpdate"`): quando è
disponibile una nuova versione, l'editor mostra un banner con un pulsante
"Aggiorna" invece di ricaricare da solo la pagina, per non perdere
silenziosamente lo stato della scena corrente in memoria (nessuna
persistenza di scena/prefab ancora — arriva in Fase 5).

## Nota — verifica manuale necessaria

Il comportamento interattivo reale (drag del gizmo, digitazione nei campi
Inspector, installazione PWA e funzionamento offline) non è coperto da test
automatici: dipende da un vero `WebGPURenderer`/canvas/`requestAnimationFrame`
e, per la PWA, da un vero service worker di un browser — non riproducibili in
Vitest/jsdom o in una sandbox senza browser. Build/typecheck/lint/test
automatici sono verificati ad ogni fase; lo smoke-test manuale con
`pnpm dev:editor` (interattività) e `pnpm --filter editor build` +
`pnpm --filter editor preview` (installazione/offline PWA) resta a carico
dell'utente.
