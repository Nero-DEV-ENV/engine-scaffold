import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index.js";

describe("core placeholder", () => {
  it("esporta una versione valida", () => {
    expect(ENGINE_VERSION).toBe("0.0.1");
  });
});
