import { describe, it, expect, vi, beforeEach } from "vitest";
import { TunnelHostSession, type TunnelHostState } from "./tunnelHostSession.js";

/**
 * tunnelHostSession.test.ts — Fase 6F.3.b. A differenza di
 * processSupervisor.test.ts (nessun mock di child_process: lì il
 * comportamento cross-piattaforma di spawn/kill è il punto da verificare
 * per davvero), qui @engine/tunnel viene MOCCATO. La meccanica WebRTC/ICE
 * reale (createHostOffer/completeHostConnection/attachHostProxy) è già
 * verificata con un vero peer werift in packages/tunnel/src/
 * rendezvous.test.ts e tunnelProtocol.integration.test.ts (~10s l'uno) —
 * ripeterla qui sarebbe ridondante. Quello che TunnelHostSession aggiunge
 * sopra quelle funzioni è pura orchestrazione (guardie di stato,
 * invalidazione delle operazioni async in volo su close()): è quello il
 * comportamento da testare in questo file.
 */

const mocks = vi.hoisted(() => ({
  createHostOffer: vi.fn(),
  completeHostConnection: vi.fn(),
  attachHostProxy: vi.fn(),
}));

vi.mock("@engine/tunnel", () => ({
  createHostOffer: mocks.createHostOffer,
  completeHostConnection: mocks.completeHostConnection,
  attachHostProxy: mocks.attachHostProxy,
}));

function fakeSession(offerBlob = "fake-offer-blob"): {
  peerConnection: { close: ReturnType<typeof vi.fn> };
  controlChannel: Record<string, never>;
  dataChannel: Record<string, never>;
  offerBlob: string;
} {
  return {
    peerConnection: { close: vi.fn().mockResolvedValue(undefined) },
    controlChannel: {},
    dataChannel: {},
    offerBlob,
  };
}

beforeEach(() => {
  mocks.createHostOffer.mockReset();
  mocks.completeHostConnection.mockReset();
  mocks.attachHostProxy.mockReset();
});

describe("TunnelHostSession", () => {
  it("startOffer(): idle -> generating-offer -> awaiting-answer con offerBlob", async () => {
    const session = fakeSession("blob-123");
    mocks.createHostOffer.mockResolvedValue(session);
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });

    const startPromise = tunnelHost.startOffer();
    expect(tunnelHost.getState().status).toBe("generating-offer");

    expect(await startPromise).toBe(true);
    expect(tunnelHost.getState()).toEqual({ status: "awaiting-answer", offerBlob: "blob-123" });
  });

  it("startOffer() è no-op (false) se lo stato non è idle/error", async () => {
    mocks.createHostOffer.mockImplementation(() => new Promise(() => {})); // non risolve mai in questo test
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });
    void tunnelHost.startOffer();
    expect(tunnelHost.getState().status).toBe("generating-offer");
    expect(await tunnelHost.startOffer()).toBe(false);
  });

  it("startOffer(): createHostOffer() fallita -> stato error", async () => {
    mocks.createHostOffer.mockRejectedValue(new Error("ICE gathering fallita"));
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });
    expect(await tunnelHost.startOffer()).toBe(false);
    expect(tunnelHost.getState().status).toBe("error");
  });

  it("complete() è no-op (false) se lo stato non è awaiting-answer", async () => {
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });
    expect(await tunnelHost.complete("answer-blob")).toBe(false);
  });

  it("complete(): awaiting-answer -> connecting -> connected, aggancia attachHostProxy col colyseusHttpUrl configurato", async () => {
    const session = fakeSession();
    mocks.createHostOffer.mockResolvedValue(session);
    mocks.completeHostConnection.mockResolvedValue(undefined);
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:9999" });

    await tunnelHost.startOffer();
    const completePromise = tunnelHost.complete("guest-answer-blob");
    expect(tunnelHost.getState().status).toBe("connecting");

    expect(await completePromise).toBe(true);
    expect(tunnelHost.getState().status).toBe("connected");
    expect(mocks.completeHostConnection).toHaveBeenCalledWith(session, "guest-answer-blob");
    expect(mocks.attachHostProxy).toHaveBeenCalledWith(session, { colyseusHttpUrl: "http://localhost:9999" });
  });

  it("complete(): completeHostConnection() fallita -> stato error, attachHostProxy MAI chiamata", async () => {
    const session = fakeSession();
    mocks.createHostOffer.mockResolvedValue(session);
    mocks.completeHostConnection.mockRejectedValue(new Error("setRemoteDescription fallita"));
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });

    await tunnelHost.startOffer();
    expect(await tunnelHost.complete("bad-blob")).toBe(false);
    expect(tunnelHost.getState().status).toBe("error");
    expect(mocks.attachHostProxy).not.toHaveBeenCalled();
  });

  it("close() è no-op (false) se lo stato è idle", () => {
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });
    expect(tunnelHost.close()).toBe(false);
  });

  it("close() chiude il peerConnection e torna a idle da 'connected'", async () => {
    const session = fakeSession();
    mocks.createHostOffer.mockResolvedValue(session);
    mocks.completeHostConnection.mockResolvedValue(undefined);
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });
    await tunnelHost.startOffer();
    await tunnelHost.complete("answer-blob");

    expect(tunnelHost.close()).toBe(true);
    expect(tunnelHost.getState().status).toBe("idle");
    expect(session.peerConnection.close).toHaveBeenCalledOnce();
  });

  it("close() durante generating-offer invalida il risultato tardivo: mai awaiting-answer, chiude il peerConnection stale", async () => {
    const session = fakeSession();
    let resolveOffer!: (value: typeof session) => void;
    mocks.createHostOffer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOffer = resolve;
        }),
    );
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });

    const startPromise = tunnelHost.startOffer();
    expect(tunnelHost.getState().status).toBe("generating-offer");

    expect(tunnelHost.close()).toBe(true);
    expect(tunnelHost.getState().status).toBe("idle");

    resolveOffer(session);
    expect(await startPromise).toBe(false);
    expect(tunnelHost.getState().status).toBe("idle");
    expect(session.peerConnection.close).toHaveBeenCalledOnce();
  });

  it("emette eventi 'state' ad ogni transizione", async () => {
    const session = fakeSession();
    mocks.createHostOffer.mockResolvedValue(session);
    const tunnelHost = new TunnelHostSession({ colyseusHttpUrl: "http://localhost:2567" });
    const seen: TunnelHostState["status"][] = [];
    tunnelHost.on("state", (state: TunnelHostState) => seen.push(state.status));

    await tunnelHost.startOffer();
    expect(seen).toEqual(["generating-offer", "awaiting-answer"]);
  });
});
