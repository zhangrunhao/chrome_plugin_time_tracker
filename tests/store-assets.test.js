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
