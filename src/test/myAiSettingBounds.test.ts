import test from "node:test";
import assert from "node:assert/strict";
import {
  clampIndexIncrementalSaveDebounceMs,
  clampMissionHeartbeatSeconds,
  clampTraceAutoRefreshIntervalMs,
  INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MAX,
  INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MIN,
  MISSION_HEARTBEAT_SECONDS_MIN,
  TRACE_AUTO_REFRESH_INTERVAL_MS_MAX,
  TRACE_AUTO_REFRESH_INTERVAL_MS_MIN
} from "../config/myAiSettingBounds";

test("clampTraceAutoRefreshIntervalMs", () => {
  assert.equal(clampTraceAutoRefreshIntervalMs(1000), TRACE_AUTO_REFRESH_INTERVAL_MS_MIN);
  assert.equal(clampTraceAutoRefreshIntervalMs(5000), 5000);
  assert.equal(clampTraceAutoRefreshIntervalMs(200_000), TRACE_AUTO_REFRESH_INTERVAL_MS_MAX);
});

test("clampIndexIncrementalSaveDebounceMs", () => {
  assert.equal(clampIndexIncrementalSaveDebounceMs(50), INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MIN);
  assert.equal(clampIndexIncrementalSaveDebounceMs(2000), 2000);
  assert.equal(clampIndexIncrementalSaveDebounceMs(99_000), INDEX_INCREMENTAL_SAVE_DEBOUNCE_MS_MAX);
});

test("clampMissionHeartbeatSeconds", () => {
  assert.equal(clampMissionHeartbeatSeconds(1), MISSION_HEARTBEAT_SECONDS_MIN);
  assert.equal(clampMissionHeartbeatSeconds(12), 12);
  assert.equal(clampMissionHeartbeatSeconds(8.2), 8);
});
