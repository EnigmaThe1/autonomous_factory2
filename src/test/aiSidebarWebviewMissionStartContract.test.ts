import test from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";

test("webview shell: start-mission card keeps blueprint hint host + mission settings shortcut", async () => {
  const src = await nodeFs.readFile(
    nodePath.join(process.cwd(), "src", "ui", "aiSidebarWebviewHtml.ts"),
    "utf8"
  );
  assert.match(src, /id="missionStartBlueprintHint"/);
  assert.match(src, /data-action="openSettings"/);
  assert.match(src, /data-query="myAi\.missions"/);
});

test("webview panel bundle: settings tab mission blueprint rows + openSettings shortcut", async () => {
  const src = await nodeFs.readFile(
    nodePath.join(process.cwd(), "media", "chat", "webviewPanelBundle.js"),
    "utf8"
  );
  assert.match(src, /function missionBlueprintSettingsRowsHtml/);
  assert.match(src, /Mission blueprint mode/);
  assert.match(src, /Edit mission settings in VS Code/);
  assert.match(src, /data-query="myAi\.missions"/);
});
