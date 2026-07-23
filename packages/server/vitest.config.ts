import { defineConfig } from "vitest/config";

// pool: "threads" (worker_threads) invece del default "forks" (child_process):
// qualcosa nello stack di Colyseus (con ogni probabilità @pm2/io, peer
// dependency di @colyseus/core che intercetta process.send per riportare
// metriche PM2 quando rileva un canale IPC disponibile) chiama process.send()
// sullo stesso canale che il pool "forks" di Vitest usa per il proprio
// protocollo interno worker↔main, corrompendolo — bug documentato upstream
// (vitest-dev/vitest#7082, stesso stack trace esatto). Sotto worker_threads
// process.send non esiste, quindi il conflitto non si presenta. Verificato
// empiricamente: identico crash con pool default e con --pool=forks, test
// pulito con --pool=threads.
export default defineConfig({
  test: {
    pool: "threads",
    setupFiles: ["./vitest.setup.ts"],
  },
});
