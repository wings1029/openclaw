/**
 * Regression tests for #92960: sessions.describe forwards agentId to session target resolution.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsHandlers } from "./sessions.js";
import type { GatewayRequestContext, RespondFn } from "./types.js";

// Mock the session store and target resolution
const mockStore = vi.hoisted(() => ({}));
let targetResolved: { agentId?: string } | null = null;

vi.mock("../session-utils.js", () => ({
  resolveGatewaySessionTargetFromKey: (
    _key: string,
    _cfg: unknown,
    opts?: { agentId?: string },
  ) => {
    targetResolved = { agentId: opts?.agentId };
    return { target: { canonicalKey: "test-key", storeKeys: ["test"] }, storePath: "/test" };
  },
  resolveFreshestSessionEntryFromStoreKeys: () => ({ sessionId: "test-session" }),
  buildGatewaySessionRow: () => ({ key: "test", sessionId: "test-session" }),
  loadSessionStore: () => mockStore,
}));

describe("sessions.describe agent scope", () => {
  beforeEach(() => {
    targetResolved = null;
  });

  it("forwards agentId to session target resolution", async () => {
    const respond = vi.fn() as unknown as RespondFn;
    const context = {
      chatAbortControllers: new Map(),
      broadcastToConnIds: vi.fn(),
      getSessionEventSubscriberConnIds: () => new Set<string>(),
      getRuntimeConfig: () => ({}),
    } as unknown as GatewayRequestContext;

    await sessionsHandlers["sessions.describe"]({
      params: { key: "agent:test:direct:user:123", agentId: "test-agent" },
      respond,
      context,
    });

    expect(targetResolved).not.toBeNull();
    expect(targetResolved!.agentId).toBe("test-agent");
  });

  it("resolves correctly without agentId (backward compatible)", async () => {
    const respond = vi.fn() as unknown as RespondFn;
    const context = {
      chatAbortControllers: new Map(),
      broadcastToConnIds: vi.fn(),
      getSessionEventSubscriberConnIds: () => new Set<string>(),
      getRuntimeConfig: () => ({}),
    } as unknown as GatewayRequestContext;

    await sessionsHandlers["sessions.describe"]({
      params: { key: "agent:test:direct:user:123" },
      respond,
      context,
    });

    expect(targetResolved).not.toBeNull();
    expect(targetResolved!.agentId).toBeUndefined();
  });
});
