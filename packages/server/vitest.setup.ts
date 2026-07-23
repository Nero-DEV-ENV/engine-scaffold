import { inspect } from "node:util";

process.on("unhandledRejection", (reason) => {
  console.error("[vitest.setup] unhandledRejection (raw):", inspect(reason, { depth: 5 }));
});
process.on("uncaughtException", (err) => {
  console.error("[vitest.setup] uncaughtException (raw):", inspect(err, { depth: 5 }));
});
