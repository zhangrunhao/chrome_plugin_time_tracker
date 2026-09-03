import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("declares only the runtime permissions and HTTP(S) content injection", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

  assert.equal(manifest.name, "WebTrace");
  assert.equal(manifest.version, "1.1.0");
  assert.equal(
    manifest.description,
    "WebTrace 在本机统计你配置的网站打开次数与有效观看时长，并展示最近 14 天趋势和访问明细。",
  );
  assert.equal(manifest.minimum_chrome_version, "102");
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["idle", "storage", "unlimitedStorage", "webNavigation"],
  );
  assert.deepEqual([...manifest.host_permissions].sort(), ["http://*/*", "https://*/*"]);
  assert.deepEqual(
    [...manifest.content_scripts[0].matches].sort(),
    ["http://*/*", "https://*/*"],
  );
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
  assert.equal("css" in manifest.content_scripts[0], false);
  assert.deepEqual(manifest.background, {
    service_worker: "background.js",
    type: "module",
  });
  assert.deepEqual(manifest.icons, {
    "16": "images/icon_16.png",
    "32": "images/icon_32.png",
    "48": "images/icon_48.png",
    "128": "images/icon_128.png",
  });
  assert.equal("default_popup" in manifest.action, false);
});
