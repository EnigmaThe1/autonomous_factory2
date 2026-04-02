import test from "node:test";
import assert from "node:assert/strict";
import {
  clampDashboardPollIntervalMs,
  DASHBOARD_POLL_INTERVAL_MS_MAX,
  DASHBOARD_POLL_INTERVAL_MS_MIN
} from "../ui/aiSidebarConstants";

test("clampDashboardPollIntervalMs: clamps to package.json min/max", () => {
  assert.equal(clampDashboardPollIntervalMs(500), DASHBOARD_POLL_INTERVAL_MS_MIN);
  assert.equal(clampDashboardPollIntervalMs(2000), DASHBOARD_POLL_INTERVAL_MS_MIN);
  assert.equal(clampDashboardPollIntervalMs(25_000), 25_000);
  assert.equal(clampDashboardPollIntervalMs(200_000), DASHBOARD_POLL_INTERVAL_MS_MAX);
  assert.equal(clampDashboardPollIntervalMs(DASHBOARD_POLL_INTERVAL_MS_MAX), DASHBOARD_POLL_INTERVAL_MS_MAX);
});

test("clampDashboardPollIntervalMs: floors non-integers", () => {
  assert.equal(clampDashboardPollIntervalMs(10_000.7), 10_000);
});
