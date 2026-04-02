import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("package.json: sidebar view/title menus for capabilities, blueprint, mission settings", () => {
  const pkgPath = path.join(process.cwd(), "package.json");
  const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    activationEvents: string[];
    contributes: {
      commands: { command: string; title?: string; icon?: string }[];
      menus?: { "view/title"?: { command: string; when?: string; group?: string }[] };
    };
  };
  const sidebarTitleCommands = [
    "myAi.openAgentCapabilitiesDoc",
    "myAi.openMissionAutonomyBlueprint",
    "myAi.openMissionSettings"
  ] as const;
  for (const id of sidebarTitleCommands) {
    assert.ok(raw.activationEvents.includes(`onCommand:${id}`), `activationEvents should list onCommand:${id}`);
    const cmd = raw.contributes.commands.find((c) => c.command === id);
    assert.ok(cmd, `contributes.commands should register ${id}`);
    assert.ok(cmd?.icon, `${id} should have a view-title icon`);
  }
  const titleMenus = raw.contributes.menus?.["view/title"] ?? [];
  const sidebarTitle = titleMenus.filter((m) => m.when === "view == myAi.sidebar");
  assert.deepEqual(
    sidebarTitle.map((m) => ({ command: m.command, group: m.group })),
    [
      { command: "myAi.openAgentCapabilitiesDoc", group: "navigation@33" },
      { command: "myAi.openMissionAutonomyBlueprint", group: "navigation@34" },
      { command: "myAi.openMissionSettings", group: "navigation@35" }
    ],
    "Chat & Missions view/title actions should stay map → book → gear (stable operator muscle memory)"
  );
});
