import type { MissionStore } from "./MissionStore";

export async function saveOperatorActionMissionEventIfChanged(args: {
  store: MissionStore;
  missionId: string;
  message: string;
  level?: "info" | "warn" | "error";
  source?: string;
}): Promise<void> {
  const level = args.level ?? "info";
  const source = args.source ?? "operator-action";
  const mission = args.store.get(args.missionId);
  if (!mission) return;
  const last = mission.events[mission.events.length - 1];
  if (last && last.source === source && last.message === args.message && last.level === level) return;
  await args.store.saveEvent(args.missionId, { level, source, message: args.message });
}

