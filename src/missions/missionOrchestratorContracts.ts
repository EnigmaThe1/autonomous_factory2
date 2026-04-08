import type {
  AgentRunOptions,
  AgentTurnResult,
  ChatContext,
  Mission,
  ToolCall,
  WorkItem
} from "../types";
import type { ToolResult } from "../tools/ToolRegistry";

export type MissionToolExecutor = {
  execute(missionId: string, call: ToolCall): Promise<ToolResult>;
};

export type MissionAgentRunForTest = (
  mission: Mission,
  item: WorkItem,
  context: ChatContext,
  opts: AgentRunOptions
) => Promise<AgentTurnResult>;
