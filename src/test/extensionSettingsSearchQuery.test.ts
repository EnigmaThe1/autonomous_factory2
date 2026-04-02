import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXTENSION_SETTINGS_SEARCH,
  MISSION_SETTINGS_SEARCH_QUERY,
  sanitizeExtensionSettingsSearchQuery
} from "../ui/extensionSettingsSearchQuery";

test("sanitizeExtensionSettingsSearchQuery: empty or invalid falls back to myAi", () => {
  assert.equal(sanitizeExtensionSettingsSearchQuery(undefined), DEFAULT_EXTENSION_SETTINGS_SEARCH);
  assert.equal(sanitizeExtensionSettingsSearchQuery(""), DEFAULT_EXTENSION_SETTINGS_SEARCH);
  assert.equal(sanitizeExtensionSettingsSearchQuery("   "), DEFAULT_EXTENSION_SETTINGS_SEARCH);
  assert.equal(sanitizeExtensionSettingsSearchQuery("evil"), DEFAULT_EXTENSION_SETTINGS_SEARCH);
  assert.equal(sanitizeExtensionSettingsSearchQuery("myAi;drop"), DEFAULT_EXTENSION_SETTINGS_SEARCH);
});

test("sanitizeExtensionSettingsSearchQuery: allows myAi and dotted keys", () => {
  assert.equal(sanitizeExtensionSettingsSearchQuery("myAi"), "myAi");
  assert.equal(sanitizeExtensionSettingsSearchQuery("myAi.missions"), MISSION_SETTINGS_SEARCH_QUERY);
  assert.equal(sanitizeExtensionSettingsSearchQuery("  myAi.missions  "), MISSION_SETTINGS_SEARCH_QUERY);
  assert.equal(
    sanitizeExtensionSettingsSearchQuery("myAi.missions.blueprintMode"),
    "myAi.missions.blueprintMode"
  );
});
