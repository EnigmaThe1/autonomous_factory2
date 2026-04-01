import test from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";

test("webview shell: chat, providers, and settings model fields expose catalog picker affordance", async () => {
  const src = await nodeFs.readFile(nodePath.join(process.cwd(), "src", "ui", "aiSidebarWebviewHtml.ts"), "utf8");
  assert.match(src, /id="chatModelInput"/);
  assert.match(src, /id="btnChatModelCatalog"/);
  assert.match(src, /id="chatModelCatalogPopover"/);
  assert.match(src, /data-model-picker-scope="chatRow"/);

  assert.match(src, /id="panelModelInput"/);
  assert.match(src, /id="btnPanelModelCatalog"/);
  assert.match(src, /data-model-picker-scope="providersForm"/);

  assert.match(src, /id="settingDefaultModel"/);
  assert.match(src, /id="btnSettingDefaultModelCatalog"/);
  assert.match(src, /id="settingDefaultModelCatalogPopover"/);
  assert.match(src, /data-model-picker-scope="quickSettings"/);
});
