import * as vscode from "vscode";
import { ContextCollector } from "../context/ContextCollector";
import { GlobalMemoryStore } from "../memory/GlobalMemoryStore";
import {
  MissionAgentRunForTest,
  MissionOrchestrator,
  MissionToolExecutor
} from "../missions/MissionOrchestrator";
import { MissionStore } from "../missions/MissionStore";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { SecretStore } from "../storage/SecretStore";
import { DiskMissionPersistence } from "../storage/DiskMissionPersistence";
import { WorkspacePaths } from "../storage/WorkspacePaths";
import type { AgentRole, AgentTurnResult, Mission, MissionPolicy, WorkItem } from "../types";
import { uid } from "../util";

export type VscodeTestApi = typeof vscode & {
  __clearTestConfig?: () => void;
  __setTestConfig?: (key: string, value: unknown) => void;
};

export function memento(): vscode.Memento {
  const data = new Map<string, unknown>();
  return {
    keys: () => [...data.keys()],
    get: <T>(key: string, defaultValue?: T) => (data.has(key) ? (data.get(key) as T) : (defaultValue as T)),
    update: async (key: string, value: unknown) => {
      data.set(key, value);
    }
  };
}

export function buildStandardNextQueue(): WorkItem[] {
  return [
    {
      id: uid("work"),
      title: "Implementation tranche",
      role: "implementer",
      status: "todo",
      prompt: "Implement a bounded change."
    },
    {
      id: uid("work"),
      title: "Review tranche",
      role: "reviewer",
      status: "todo",
      prompt: "Review implementation."
    },
    {
      id: uid("work"),
      title: "Validation tranche",
      role: "validator",
      status: "todo",
      prompt: "Validate closure."
    }
  ];
}

/** Two implementer tranches before review/validate (ordered execution). */
export function buildTwoImplThenReviewValidateQueue(): WorkItem[] {
  return [
    {
      id: "wi-impl-a",
      title: "First implementation tranche",
      role: "implementer",
      status: "todo",
      prompt: "First bounded change."
    },
    {
      id: "wi-impl-b",
      title: "Second implementation tranche",
      role: "implementer",
      status: "todo",
      prompt: "Second bounded change."
    },
    {
      id: "wi-rev",
      title: "Review tranche",
      role: "reviewer",
      status: "todo",
      prompt: "Review."
    },
    {
      id: "wi-val",
      title: "Validation tranche",
      role: "validator",
      status: "todo",
      prompt: "Validate."
    }
  ];
}

/** Implementer, review, validate, then a late implementer (e.g. stale patch after validation passed). */
export function buildImplRevValPlusLateImplementerQueue(): WorkItem[] {
  return [
    {
      id: "wi-impl-early",
      title: "Implementation tranche",
      role: "implementer",
      status: "todo",
      prompt: "Implement."
    },
    {
      id: "wi-rev",
      title: "Review tranche",
      role: "reviewer",
      status: "todo",
      prompt: "Review."
    },
    {
      id: "wi-val",
      title: "Validation tranche",
      role: "validator",
      status: "todo",
      prompt: "Validate."
    },
    {
      id: "wi-impl-late",
      title: "Late implementation tranche",
      role: "implementer",
      status: "todo",
      prompt: "Follow-up patch."
    }
  ];
}

export function roleScript(turns: Partial<Record<AgentRole, AgentTurnResult[]>>): MissionAgentRunForTest {
  const idx: Partial<Record<AgentRole, number>> = {};
  return async (_mission, item) => {
    const list = turns[item.role];
    const i = idx[item.role] ?? 0;
    idx[item.role] = i + 1;
    if (!list || i >= list.length) {
      throw new Error(`missionOrchestratorTestHarness: missing script for role=${item.role} index=${i}`);
    }
    return list[i]!;
  };
}

export const balancedIntegrationPolicy: Partial<MissionPolicy> = {
  minCompletedWorkItems: 4,
  requireValidationEvidence: false,
  maxAutoRounds: 24,
  closureRequired: true,
  requireReviewerBeforeComplete: true,
  requireValidatorBeforeComplete: true,
  requireImplementerBeforeComplete: true,
  autoContinue: true,
  stallReplanThreshold: 3,
  policyPreset: "balanced"
};

export async function createOrchestrator(
  agentRunForTest: MissionAgentRunForTest,
  toolImpl: MissionToolExecutor["execute"]
): Promise<{ orchestrator: MissionOrchestrator; store: MissionStore }> {
  const globalState = memento();
  const workspaceState = memento();
  const disk = new DiskMissionPersistence(new WorkspacePaths());
  const store = new MissionStore(globalState, workspaceState, disk);
  const globalMemory = new GlobalMemoryStore(globalState, disk);
  const secrets = new Map<string, string>();
  const secretStore = new SecretStore({
    get: async (k: string) => secrets.get(k),
    store: async (k: string, v: string) => {
      secrets.set(k, v);
    },
    delete: async (k: string) => {
      secrets.delete(k);
    }
  } as unknown as vscode.SecretStorage);
  const providers = new ProviderRegistry(secretStore);
  const collector = new ContextCollector();
  const tools: MissionToolExecutor = { execute: toolImpl };
  const orchestrator = new MissionOrchestrator(
    providers,
    collector,
    store,
    tools,
    globalMemory,
    agentRunForTest
  );
  return { orchestrator, store };
}

/** Wires `roleScriptWithAborts` to the orchestrator instance after construction (abort callbacks need the real host). */
export async function createOrchestratorWithAbortSupport(
  turns: Partial<Record<AgentRole, Array<AgentTurnResult | AbortScriptStep>>>,
  toolImpl: MissionToolExecutor["execute"]
): Promise<{ orchestrator: MissionOrchestrator; store: MissionStore }> {
  const ref: { o?: MissionOrchestrator } = {};
  const agent = roleScriptWithAborts(() => ref.o!, turns);
  const out = await createOrchestrator(agent, toolImpl);
  ref.o = out.orchestrator;
  return out;
}

export function queueStructuralFingerprint(m: Mission): string {
  return m.queue.map((w) => `${w.id}:${w.role}:${w.title}`).join("|");
}

export type AbortScriptStep = "abort_operator" | "abort_timeout";

/** Scripted turns where some invocations simulate stream abort (operator blocks mission; timeout fails item and continues). */
export function roleScriptWithAborts(
  getOrchestrator: () => MissionOrchestrator,
  turns: Partial<Record<AgentRole, Array<AgentTurnResult | AbortScriptStep>>>
): MissionAgentRunForTest {
  const idx: Partial<Record<AgentRole, number>> = {};
  return async (mission, item, _context, opts) => {
    const role = item.role;
    const i = idx[role] ?? 0;
    idx[role] = i + 1;
    const list = turns[role];
    if (!list || i >= list.length) {
      throw new Error(`roleScriptWithAborts: missing ${role}[${i}]`);
    }
    const step = list[i]!;
    if (step === "abort_operator") {
      queueMicrotask(() => {
        getOrchestrator().abortMissionWork(mission.id, "operator");
      });
      await abortHarnessSignal(opts.signal);
      throw new Error("unreachable");
    }
    if (step === "abort_timeout") {
      const e = new Error("request timed out");
      (e as Error & { name: string }).name = "AbortError";
      throw e;
    }
    return step;
  };
}

async function abortHarnessSignal(signal?: AbortSignal): Promise<never> {
  if (!signal) throw new DOMException("Aborted", "AbortError");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((_, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  throw new Error("unreachable");
}

/** Delegates to `orchestrator.whenMissionRunLoopIdle` (same semantics). */
export async function awaitMissionRunLoopIdle(
  orchestrator: MissionOrchestrator,
  missionId: string,
  timeoutMs = 15_000
): Promise<void> {
  await orchestrator.whenMissionRunLoopIdle(missionId, { timeoutMs });
}

/** Waits for `isMissionTerminalLifecycleStatus` or timeout (delegates to orchestrator). */
export async function awaitMissionTerminalLifecycleStatus(
  orchestrator: MissionOrchestrator,
  missionId: string,
  timeoutMs = 120_000
): Promise<void> {
  await orchestrator.whenMissionReachesTerminalLifecycleStatus(missionId, { timeoutMs });
}

export async function runMissionUntilCompleted(
  orchestrator: MissionOrchestrator,
  store: MissionStore,
  missionId: string,
  maxPasses: number
): Promise<Mission> {
  for (let p = 0; p < maxPasses; p++) {
    await orchestrator.runMission(missionId);
    const m = store.get(missionId)!;
    if (m.status === "completed") return m;
    if (["blocked", "awaiting_input", "failed"].includes(m.status)) {
      throw new Error(`runMissionUntilCompleted: unexpected ${m.status}: ${m.blocker}`);
    }
  }
  const m = store.get(missionId)!;
  throw new Error(`runMissionUntilCompleted: not completed after ${maxPasses} passes (status=${m.status})`);
}
