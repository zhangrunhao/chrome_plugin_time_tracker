import { copyFile, mkdir } from "node:fs/promises";

await mkdir("vendor/tldts", { recursive: true });
await Promise.all([
  copyFile("node_modules/tldts/dist/index.esm.min.js", "vendor/tldts/index.esm.min.js"),
  copyFile("node_modules/tldts/LICENSE", "vendor/tldts/LICENSE"),
]);
