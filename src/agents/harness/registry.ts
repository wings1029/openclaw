/**
 * Registry for native agent harness implementations and lifecycle cleanup.
 */
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type {
  AgentHarness,
  AgentHarnessDeliveryDefaults,
  AgentHarnessResetParams,
  RegisteredAgentHarness,
} from "./types.js";

/**
 * Process-wide registry for agent harnesses contributed by core and runtime plugins.
 *
 * The registry is global-symbol backed so repeated imports, test module resets, and plugin lazy
 * loads share one harness table inside a running gateway process.
 */
const AGENT_HARNESS_REGISTRY_STATE = Symbol.for("openclaw.agentHarnessRegistryState");
const log = createSubsystemLogger("agents/harness");

type AgentHarnessRegistryState = {
  harnesses: Map<string, RegisteredAgentHarness>;
};

const agentHarnessSnapshotFields = [
  "label",
  "pluginId",
  "contextEngineHostCapabilities",
  "deliveryDefaults",
  "supports",
  "runAttempt",
  "runSideQuestion",
  "classify",
  "compact",
  "reset",
  "dispose",
] as const satisfies readonly (keyof AgentHarness)[];

function getAgentHarnessRegistryState(): AgentHarnessRegistryState {
  const globalState = globalThis as typeof globalThis & {
    [AGENT_HARNESS_REGISTRY_STATE]?: AgentHarnessRegistryState;
  };
  globalState[AGENT_HARNESS_REGISTRY_STATE] ??= {
    harnesses: new Map<string, RegisteredAgentHarness>(),
  };
  return globalState[AGENT_HARNESS_REGISTRY_STATE];
}

function bindAgentHarnessFunction<TFunction>(harness: AgentHarness, fn: TFunction): TFunction {
  if (typeof fn !== "function") {
    return fn;
  }
  return function (this: unknown, ...args: unknown[]) {
    return Reflect.apply(fn as (...args: unknown[]) => unknown, harness, args);
  } as TFunction;
}

function snapshotAgentHarnessDeliveryDefaults(
  value: unknown,
): AgentHarnessDeliveryDefaults | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    return value as AgentHarnessDeliveryDefaults;
  }
  const source = value as Partial<AgentHarnessDeliveryDefaults>;
  if (source.sourceVisibleReplies === undefined) {
    return {};
  }
  return { sourceVisibleReplies: source.sourceVisibleReplies };
}

function snapshotAgentHarnessValue(
  harness: AgentHarness,
  key: (typeof agentHarnessSnapshotFields)[number],
  value: unknown,
): unknown {
  if (typeof value === "function") {
    return bindAgentHarnessFunction(harness, value);
  }
  if (key === "contextEngineHostCapabilities" && Array.isArray(value)) {
    return [...value];
  }
  if (key === "deliveryDefaults") {
    return snapshotAgentHarnessDeliveryDefaults(value);
  }
  return value;
}

export function snapshotAgentHarness(
  harness: AgentHarness,
  options: { ownerPluginId?: string } = {},
): AgentHarness {
  const rawId = harness.id;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  const snapshot = { id } as Partial<AgentHarness>;
  for (const key of agentHarnessSnapshotFields) {
    const value = harness[key];
    if (value === undefined) {
      continue;
    }
    snapshot[key] = snapshotAgentHarnessValue(harness, key, value) as never;
  }
  if (!snapshot.pluginId && options.ownerPluginId) {
    snapshot.pluginId = options.ownerPluginId;
  }
  return snapshot as AgentHarness;
}

/** Registers or replaces an agent harness under its trimmed id. */
export function registerAgentHarness(
  harness: AgentHarness,
  options?: { ownerPluginId?: string },
): void {
  const snapshot = snapshotAgentHarness(harness, options);
  const id = snapshot.id;
  if (!id) {
    throw new Error("agent harness registration missing id");
  }
  getAgentHarnessRegistryState().harnesses.set(id, {
    harness: snapshot,
    ownerPluginId: options?.ownerPluginId,
  });
}

/** Returns the active harness for an id, if one has been registered. */
export function getAgentHarness(id: string): AgentHarness | undefined {
  return getRegisteredAgentHarness(id)?.harness;
}

/** Returns the harness plus plugin ownership metadata for registry diagnostics. */
export function getRegisteredAgentHarness(id: string): RegisteredAgentHarness | undefined {
  return getAgentHarnessRegistryState().harnesses.get(id.trim());
}

/** Lists registered harness ids in insertion order. */
export function listAgentHarnessIds(): string[] {
  return [...getAgentHarnessRegistryState().harnesses.keys()];
}

/** Lists registered harness records for selection and lifecycle fan-out. */
export function listRegisteredAgentHarnesses(): RegisteredAgentHarness[] {
  return Array.from(getAgentHarnessRegistryState().harnesses.values());
}

/** Clears all harnesses; intended for tests and controlled registry reloads. */
export function clearAgentHarnesses(): void {
  getAgentHarnessRegistryState().harnesses.clear();
}

/** Restores a prior harness snapshot after tests temporarily replace the registry. */
export function restoreRegisteredAgentHarnesses(entries: RegisteredAgentHarness[]): void {
  const map = getAgentHarnessRegistryState().harnesses;
  map.clear();
  for (const entry of entries) {
    map.set(entry.harness.id, entry);
  }
}

/** Calls each registered harness session-reset hook without letting one failure stop the fan-out. */
export async function resetRegisteredAgentHarnessSessions(
  params: AgentHarnessResetParams,
): Promise<void> {
  await Promise.all(
    listRegisteredAgentHarnesses().map(async (entry) => {
      if (!entry.harness.reset) {
        return;
      }
      try {
        await entry.harness.reset(params);
      } catch (error) {
        log.warn(`${entry.harness.label} session reset hook failed`, {
          harnessId: entry.harness.id,
          error,
        });
      }
    }),
  );
}

/** Calls each registered harness dispose hook during registry shutdown or reload. */
export async function disposeRegisteredAgentHarnesses(): Promise<void> {
  await Promise.all(
    listRegisteredAgentHarnesses().map(async (entry) => {
      if (!entry.harness.dispose) {
        return;
      }
      try {
        await entry.harness.dispose();
      } catch (error) {
        log.warn(`${entry.harness.label} dispose hook failed`, {
          harnessId: entry.harness.id,
          error,
        });
      }
    }),
  );
}
