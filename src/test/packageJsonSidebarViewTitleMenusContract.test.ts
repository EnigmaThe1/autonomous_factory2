import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

test("package.json: sidebar view/title menus for blueprint doc + mission settings", () => {
  const pkgPath = path.join(process.cwd(), "package.json");
  const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    activationEvents: string[];
    contributes: {
      commands: { command: string; title?: string; icon?: string }[];
      menus?: { "view/title"?: { command: string; when?: string; group?: string }[] };
    };
  };
  for (const id of ["myAi.openMissionAutonomyBlueprint", "myAi.openMissionSettings"] as const) {
    assert.ok(raw.activationEvents.includes(`onCommand:${id}`), `activationEvents should list onCommand:${id}`);
    const cmd = raw.contributes.commands.find((c) => c.command === id);
    assert.ok(cmd, `contributes.commands should register ${id}`);
    assert.ok(cmd?.icon, `${id} should have a view-title icon`);
  }
  const titleMenus = raw.contributes.menus?.["view/title"] ?? [];
  assert.ok(
    titleMenus.some((m) => m.command === "myAi.openMissionAutonomyBlueprint" && m.when === "view == myAi.sidebar"),
    "view/title should expose Open Mission Autonomy Blueprint on the sidebar"
  );
  assert.ok(
    titleMenus.some((m) => m.command === "myAi.openMissionSettings" && m.when === "view == myAi.sidebar"),
    "view/title should expose Open Mission Settings on the sidebar"
  );
});
