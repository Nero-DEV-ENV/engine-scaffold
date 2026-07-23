import { Client } from "@colyseus/sdk";
const client = new Client("ws://localhost:2567");
const room = await client.joinOrCreate("editor_room");
console.log("joined:", room.sessionId);
await new Promise((r) => setTimeout(r, 300));
await room.leave();
console.log("left");