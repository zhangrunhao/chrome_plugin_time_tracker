import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function readPngDimensions(path) {
  const bytes = await readFile(path);
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, `${path} must be a PNG`);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test("ships the exact WebTrace icon sizes used by the manifest", async () => {
  const icons = new Map([
    ["images/icon_16.png", 16],
    ["images/icon_32.png", 32],
    ["images/icon_48.png", 48],
    ["images/icon_128.png", 128],
  ]);

  for (const [path, size] of icons) {
    assert.deepEqual(await readPngDimensions(path), {
      width: size,
      height: size,
    });
  }

  await assert.rejects(stat("images/icon_64.png"), error => error?.code === "ENOENT");
});

test("ships Chrome Web Store artwork at the required dimensions", async () => {
  const assets = new Map([
    ["store-assets/screenshots/01-dashboard-1280x800.png", [1280, 800]],
    ["store-assets/screenshots/02-add-site-1280x800.png", [1280, 800]],
    ["store-assets/promo/small-promo-440x280.png", [440, 280]],
  ]);

  for (const [path, [width, height]] of assets) {
    assert.deepEqual(await readPngDimensions(path), { width, height });
  }

  const notes = await readFile("store-assets/README.md", "utf8");
  assert.match(notes, /纯合成数据/);
  assert.match(notes, /隔离 Chrome 配置/);
  assert.match(notes, /2026-09-03/);
});
