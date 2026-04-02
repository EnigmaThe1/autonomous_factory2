import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import {
  configurationAffectsSidebarSnapshotSettings,
  MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS,
  SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS
} from "../ui/aiSidebarSettingsRead";

test("MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS: flat list matches object size and has no duplicate sections", () => {
  const flat = SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS;
  const keys = Object.keys(MYAI_SIDEBAR_SNAPSHOT_SETTINGS_KEYS);
  assert.equal(flat.length, keys.length);
  assert.equal(new Set(flat).size, flat.length);
});

test("configurationAffectsSidebarSnapshotSettings: true when any watched key changes", () => {
  for (const key of SIDEBAR_SNAPSHOT_SETTINGS_CONFIG_KEYS) {
    const e = {
      affectsConfiguration: (section: string) => section === key
    } as vscode.ConfigurationChangeEvent;
    assert.equal(configurationAffectsSidebarSnapshotSettings(e), true, `expected hit for ${key}`);
  }
});

test("configurationAffectsSidebarSnapshotSettings: false when no watched key matches", () => {
  const e = {
    affectsConfiguration: () => false
  } as vscode.ConfigurationChangeEvent;
  assert.equal(configurationAffectsSidebarSnapshotSettings(e), false);
});
