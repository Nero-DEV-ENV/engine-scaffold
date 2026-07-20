/**
 * Time — orologio globale del motore, esposto come singleton statico
 * (API Unity-style: `Time.deltaTime`, non un'istanza da passare in giro).
 *
 * `deltaTime` è il tempo trascorso dall'ultimo frame variabile (rendering,
 * input, animazioni). `fixedDeltaTime` è il passo costante usato dal
 * fixed-timestep loop (fisica in Fase 3). Il game loop (Engine.ts) è
 * l'unico responsabile di aggiornare questi valori ogni frame.
 */
export class Time {
  private static _deltaTime = 0;
  private static _fixedDeltaTime = 1 / 60;
  private static _elapsedTime = 0;
  private static _frameCount = 0;

  /** Tempo (in secondi) trascorso dall'ultimo frame variabile. */
  static get deltaTime(): number {
    return Time._deltaTime;
  }

  /** Passo temporale fisso (in secondi) usato dal fixed-update loop. */
  static get fixedDeltaTime(): number {
    return Time._fixedDeltaTime;
  }

  /** Tempo totale (in secondi) trascorso dall'avvio del loop. */
  static get elapsedTime(): number {
    return Time._elapsedTime;
  }

  /** Numero di frame variabili renderizzati dall'avvio. */
  static get frameCount(): number {
    return Time._frameCount;
  }

  /** Cambia il passo fisso di default; da chiamare prima di avviare il loop. */
  static setFixedDeltaTime(seconds: number): void {
    if (seconds <= 0) {
      throw new Error("fixedDeltaTime deve essere positivo");
    }
    Time._fixedDeltaTime = seconds;
  }

  /** @internal — chiamato solo da Engine ad ogni frame. */
  static _advance(deltaTime: number): void {
    Time._deltaTime = deltaTime;
    Time._elapsedTime += deltaTime;
    Time._frameCount += 1;
  }

  /** @internal — reset completo, usato nei test e tra run del playground. */
  static _reset(): void {
    Time._deltaTime = 0;
    Time._elapsedTime = 0;
    Time._frameCount = 0;
    Time._fixedDeltaTime = 1 / 60;
  }
}
