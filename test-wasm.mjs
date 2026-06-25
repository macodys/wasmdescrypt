import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!globalThis.performance?.now) {
  globalThis.performance = { now: () => Date.now() };
}

eval(
  fs.readFileSync(
    path.join(__dirname, "hymlcomplete/VidLink_files/script.js.download"),
    "utf8"
  )
);

const sodiumMod = await import("libsodium-wrappers");
await sodiumMod.default.ready;
globalThis.sodium = sodiumMod.default;

const go = new globalThis.Dm();
const wasmBytes = fs.readFileSync(path.join(__dirname, "fu.wasm"));
const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
go.run(instance).catch(() => {});

await new Promise((r) => setTimeout(r, 1500));

function b64urlDecode(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

for (const id of ["786892", "1", "12345", "786892"]) {
  const token = globalThis.getAdv(id);
  const raw = b64urlDecode(token);
  console.log({ id, token, len: token.length, rawLen: raw.length, rawHex: raw.toString("hex") });
}
