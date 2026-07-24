import { defineConfig } from "vitest/config";

// pool: "threads" (worker_threads) invece del default "forks" (child_process):
// stesso conflitto già documentato e risolto in packages/server/vitest.config.ts —
// packages/tunnel ora dipende anche lui da colyseus/@colyseus/core (devDependency,
// solo per l'integration test 6F.2 contro un vero server Colyseus locale), quindi
// soffre dello stesso bug (@pm2/io intercetta process.send() e corrompe il canale
// IPC worker↔main del pool "forks" di Vitest). Verificato empiricamente: stesso
// identico crash (ERR_INVALID_ARG_TYPE in vitest/deserialize) col pool default,
// pulito con --pool=threads.
export default defineConfig({
  test: {
    pool: "threads",
    setupFiles: ["./vitest.setup.ts"],
  },
});
