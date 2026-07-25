/**
 * lineSplitter.ts — Fase 6F.3.a. I chunk di stdout/stderr di un child
 * process arrivano a pezzi arbitrari, non allineati alle righe: questo
 * helper bufferizza e invoca `onLine` una volta per riga completa.
 * Gestisce sia "\n" sia "\r\n" (il processo figlio può stampare in stile
 * Windows indipendentemente dal sistema operativo su cui gira l'agente).
 */
export function createLineSplitter(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffered = "";
  return function feed(chunk: Buffer | string): void {
    buffered += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      const rawLine = buffered.slice(0, newlineIndex);
      buffered = buffered.slice(newlineIndex + 1);
      onLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine);
      newlineIndex = buffered.indexOf("\n");
    }
  };
}
