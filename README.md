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
- [ ] Fase 1 — Core runtime (GameObject/Transform/Component/loop)
- [ ] Fase 2 — Rendering pipeline (WebGPURenderer) + asset loading
- [ ] Fase 3 — Fisica (Rapier)
- [ ] Fase 4 — Editor MVP (PWA installabile)
- [ ] Fase 5 — Serializzazione scene/prefab
- [ ] Fase 6 — Differenziatore (editor collaborativo real-time)

## Sviluppo

```bash
pnpm install
pnpm build
pnpm test
pnpm dev:playground
```

## Licenza

MIT — vedi [LICENSE](./LICENSE).
