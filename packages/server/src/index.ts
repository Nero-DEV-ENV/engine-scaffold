import { Server } from "colyseus";
import { EditorRoom } from "./EditorRoom.js";

/**
 * Entry point — Fase 6A. Porta configurabile via env var `PORT` (default
 * 2567, porta di default di Colyseus) perché il deployment sui due VPS
 * Hetzner non è ancora deciso (punto 3): questo evita di dover toccare il
 * codice quando quella decisione arriverà.
 */
const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server();
gameServer.define("editor_room", EditorRoom);

await gameServer.listen(port);
console.log(`[server] editor_room in ascolto sulla porta ${port}`);
