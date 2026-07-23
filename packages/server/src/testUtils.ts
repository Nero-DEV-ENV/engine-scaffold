/**
 * testUtils.ts — helper di test condivisi per packages/server.
 *
 * `waitFor` serve per i messaggi Colyseus "fire-and-forget" (`room.send()`
 * lato client non restituisce una promise che si risolve quando il server
 * ha finito di elaborarlo): invece di un delay fisso (che sarebbe o troppo
 * corto, quindi test flaky, o troppo lungo, quindi test lenti), esegue
 * polling della condizione fino al timeout.
 */
export async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 1000, intervalMs = 10 } = options;
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condizione non soddisfatta entro ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
