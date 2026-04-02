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
