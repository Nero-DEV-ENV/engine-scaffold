# Engine (nome da definire)

Framework/engine open source per il web, con API ispirata a Unity
(GameObject/Component/Transform/lifecycle), costruito su three.js,
pensato per essere browser-native, collaborativo e installabile come PWA.

## Struttura del monorepo

- `packages/core` — runtime del motore (GameObject, Component, Transform,
  game loop, fisica, rendering pipeline)
- `packages/editor` — editor visuale, PWA installabile (Fase 4+)
- `packages/cli` — strumenti da riga di comando (scaffold progetti, build)
- `apps/playground` — sandbox per testare il core a mano durante lo sviluppo

## Stato roadmap

- [x] Fase 0 — Setup monorepo, CI, scheletro package
- [x] Fase 1 — Core runtime (GameObject/Transform/Component/loop)
- [ ] Fase 2 — Rendering pipeline (WebGPURenderer) + asset loading
- [ ] Fase 3 — Fisica (Rapier)
- [ ] Fase 4 — Editor MVP (PWA installabile)
- [ ] Fase 5 — Serializzazione scene/prefab
- [ ] Fase 6 — Differenziatore (editor collaborativo real-time)

## API core (Fase 1)

`@engine/core` espone al momento:

- `GameObject` — wrapper Unity-style su `THREE.Object3D`, con `addComponent`/`getComponent`/`getComponents`
- `Transform` — sempre presente su ogni GameObject, API Unity-style (`position`, `eulerAngles`, `rotation`, `localScale`, `forward`/`right`/`up`, `setParent`)
- `Component` — classe base astratta con lifecycle `awake()` → `start()` → `update(dt)` → `fixedUpdate(dt)` (predisposto per la fisica in Fase 3) → `onDestroy()`
- `Engine` — game loop guidato da `requestAnimationFrame`, fixed+variable timestep con accumulator pattern
- `Time` — singleton statico (`Time.deltaTime`, `Time.fixedDeltaTime`, `Time.elapsedTime`)
- `Instantiate(name?, position?)` / `Destroy(gameObject)` — la distruzione è rimandata a fine frame

Esempio minimo (vedi `apps/playground/src/main.ts` per l'uso completo con rendering three.js):

```ts
import { GameObject, Component, Engine } from "@engine/core";

class Spin extends Component {
  override update(dt: number) {
    this.transform.rotate(0, dt, 0);
  }
}

const cube = new GameObject("Cube");
cube.addComponent(Spin);

new Engine(() => renderer.render(scene, camera)).start();
```

## Sviluppo

```bash
pnpm install
pnpm build
pnpm test
pnpm dev:playground
```

## Licenza

MIT — vedi [LICENSE](./LICENSE).
