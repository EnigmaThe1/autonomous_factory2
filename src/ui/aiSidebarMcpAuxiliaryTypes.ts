import type { McpOnboardingState } from "../tools/mcpStarterConfig";
import type { McpRegistry } from "../tools/McpRegistry";

/** Success branch of warm MCP cache read — shared by poll dedupe params. */
export type McpAuxiliaryWarmRead = {
  tools: Awaited<ReturnType<McpRegistry["listTools"]>>;
  sessions: Awaited<ReturnType<McpRegistry["listSessionStates"]>>;
  onboarding: McpOnboardingState;
  toolsCacheAgeMs: number;
  onboardingCacheAgeMs: number;
};

/** MCP counts + onboarding row materialized from warm RAM caches. */
export type McpAuxiliaryWarmMaterializedSlice = {
  mcpOnboarding: McpOnboardingState;
  mcpToolCount: number;
  mcpSessionCount: number;
};
