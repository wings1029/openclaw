// Agent harness registration contracts cover plugin-owned runtime harness snapshots.
import {
  createPluginRegistryFixture,
  registerVirtualTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { clearAgentHarnesses, getRegisteredAgentHarness } from "../../agents/harness/registry.js";
import type { AgentHarness } from "../../agents/harness/types.js";

afterEach(() => {
  clearAgentHarnesses();
});

describe("agent harness registration", () => {
  it("snapshots harness fields before runtime lookup", async () => {
    let idReads = 0;
    let labelReads = 0;
    let supportsReads = 0;
    let runAttemptReads = 0;
    let resetReads = 0;
    let disposeReads = 0;
    const events: string[] = [];
    const { config, registry } = createPluginRegistryFixture();

    registerVirtualTestPlugin({
      registry,
      config,
      id: "volatile-harness-owner",
      name: "Volatile Harness Owner",
      register(api) {
        api.registerAgentHarness({
          marker: "original",
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("agent harness id getter re-read");
            }
            return " volatile-harness ";
          },
          get label() {
            labelReads += 1;
            if (labelReads > 1) {
              throw new Error("agent harness label getter re-read");
            }
            return "Volatile Harness";
          },
          get supports() {
            supportsReads += 1;
            if (supportsReads > 1) {
              throw new Error("agent harness supports getter re-read");
            }
            return function (this: { marker?: string }) {
              events.push(`supports:${this.marker ?? "missing"}`);
              return { supported: true as const, priority: 50 };
            };
          },
          get runAttempt() {
            runAttemptReads += 1;
            if (runAttemptReads > 1) {
              throw new Error("agent harness runAttempt getter re-read");
            }
            return async function (this: { marker?: string }) {
              events.push(`run:${this.marker ?? "missing"}`);
              return { ok: false as const, error: "unused" };
            };
          },
          get reset() {
            resetReads += 1;
            if (resetReads > 1) {
              throw new Error("agent harness reset getter re-read");
            }
            return async function (this: { marker?: string }) {
              events.push(`reset:${this.marker ?? "missing"}`);
            };
          },
          get dispose() {
            disposeReads += 1;
            if (disposeReads > 1) {
              throw new Error("agent harness dispose getter re-read");
            }
            return async function (this: { marker?: string }) {
              events.push(`dispose:${this.marker ?? "missing"}`);
            };
          },
        } as AgentHarness & { marker: string });
      },
    });

    expect(registry.registry.diagnostics).toEqual([]);
    const localHarness = registry.registry.agentHarnesses[0]?.harness;
    const globalHarness = getRegisteredAgentHarness("volatile-harness")?.harness;
    expect(localHarness?.id).toBe("volatile-harness");
    expect(localHarness?.pluginId).toBe("volatile-harness-owner");
    expect(globalHarness?.id).toBe("volatile-harness");
    expect(globalHarness?.pluginId).toBe("volatile-harness-owner");
    expect(localHarness?.label).toBe("Volatile Harness");
    expect(localHarness?.supports({ provider: "codex", requestedRuntime: "auto" })).toEqual({
      supported: true,
      priority: 50,
    });
    await expect(localHarness?.runAttempt({} as never)).resolves.toEqual({
      ok: false,
      error: "unused",
    });
    await globalHarness?.reset?.({ reason: "reset" });
    await globalHarness?.dispose?.();
    expect(events).toEqual([
      "supports:original",
      "run:original",
      "reset:original",
      "dispose:original",
    ]);
    expect(idReads).toBe(1);
    expect(labelReads).toBe(1);
    expect(supportsReads).toBe(1);
    expect(runAttemptReads).toBe(1);
    expect(resetReads).toBe(1);
    expect(disposeReads).toBe(1);
  });
});
