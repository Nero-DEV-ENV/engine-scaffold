import { ENGINE_VERSION } from "@engine/core";

const el = document.getElementById("app");
if (el) {
  el.innerText = `Engine playground — core v${ENGINE_VERSION} caricato correttamente`;
}
