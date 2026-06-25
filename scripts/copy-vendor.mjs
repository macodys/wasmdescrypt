import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vendorDir = path.join(root, "vendor");

const copies = [
  [
    "node_modules/libsodium/dist/modules-esm/libsodium.mjs",
    "vendor/libsodium.mjs",
  ],
  [
    "node_modules/libsodium-wrappers/dist/modules-esm/libsodium-wrappers.mjs",
    "vendor/libsodium-wrappers.mjs",
  ],
  [
    "node_modules/hls.js/dist/hls.min.js",
    "vendor/hls.min.js",
  ],
];

fs.mkdirSync(vendorDir, { recursive: true });

for (const [from, to] of copies) {
  fs.copyFileSync(path.join(root, from), path.join(root, to));
}

console.log("Copied libsodium vendor files");
