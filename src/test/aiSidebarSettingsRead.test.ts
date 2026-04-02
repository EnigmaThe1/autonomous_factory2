import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import {
  configurationAffectsSidebarSnapshotSettings,
  MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS,
  SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS
} from "../ui/aiSidebarSettingsRead";

/** Mimics VS Code: `affectsConfiguration("myAi")` is true when any `myAi.*` key changed. */
function mockConfigChangeForMyAiKey(changedKey: string): vscode.ConfigurationChangeEvent {
  return {
    affectsConfiguration: (section: string) =>
      section === changedKey || (changedKey.startsWith("myAi.") && section === "myAi")
  } as vscode.ConfigurationChangeEvent;
}

test("MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS: flat list matches object size and has no duplicate sections", () => {
  const flat = SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS;
  const keys = Object.keys(MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS);
  assert.equal(flat.length, keys.length);
  assert.equal(new Set(flat).size, flat.length);
});

test("configurationAffectsSidebarSnapshotSettings: true when any watched key changes", () => {
  for (const key of SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS) {
    assert.equal(
      configurationAffectsSidebarSnapshotSettings(mockConfigChangeForMyAiKey(key)),
      true,
      `expected hit for ${key}`
    );
  }
});

test("configurationAffectsSidebarSnapshotSettings: false when no watched key matches", () => {
  const e = {
    affectsConfiguration: () => false
  } as vscode.ConfigurationChangeEvent;
  assert.equal(configurationAffectsSidebarSnapshotSettings(e), false);
});

test("configurationAffectsSidebarSnapshotSettings: false when only other myAi keys change", () => {
  const e = {
    affectsConfiguration: (section: string) => section === "myAi" || section === "myAi.skills.enabled"
  } as vscode.ConfigurationChangeEvent;
  assert.equal(configurationAffectsSidebarSnapshotSettings(e), false);
});

test("configurationAffectsSidebarSnapshotSettings: false for non-myAi workspace settings", () => {
  const e = {
    affectsConfiguration: (section: string) => section === "typescript.updateMode"
  } as vscode.ConfigurationChangeEvent;
  assert.equal(configurationAffectsSidebarSnapshotSettings(e), false);
});
