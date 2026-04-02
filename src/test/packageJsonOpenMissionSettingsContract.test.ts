import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("package.json: myAi.openMissionSettings activation, command, and sidebar view title menu", () => {
  const pkgPath = path.join(process.cwd(), "package.json");
  const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    activationEvents: string[];
    contributes: {
      commands: { command: string; title?: string; icon?: string }[];
      menus?: { "view/title"?: { command: string; when?: string }[] };
    };
  };
  assert.ok(
    raw.activationEvents.includes("onCommand:myAi.openMissionSettings"),
    "activationEvents should list onCommand:myAi.openMissionSettings"
  );
  const cmd = raw.contributes.commands.find((c) => c.command === "myAi.openMissionSettings");
  assert.ok(cmd, "contributes.commands should register myAi.openMissionSettings");
  assert.ok(cmd?.title && cmd.title.includes("Mission Settings"), "command should have a clear title");
  const titleMenus = raw.contributes.menus?.["view/title"] ?? [];
  assert.ok(
    titleMenus.some((m) => m.command === "myAi.openMissionSettings"),
    "view/title menu should expose Open Mission Settings on the sidebar"
  );
});
