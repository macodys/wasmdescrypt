import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
eval(fs.readFileSync(path.join(root, "wasm_exec.js"), "utf8"));

const sodiumMod = await import("libsodium-wrappers");
await sodiumMod.default.ready;
globalThis.sodium = sodiumMod.default;

const go = new globalThis.Dm();
const wasm = fs.readFileSync(path.join(root, "fu.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
go.run(instance).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));

const token = globalThis.getAdv("76479");
const res = await fetch(
  `http://localhost:3000/api/stream?token=${encodeURIComponent(token)}&type=tv&season=1&episode=1&multiLang=0`
);
const data = await res.json();
const master = data.stream.playlist;
console.log("\nmaster fetch:");
const hdr = JSON.parse(new URL(master).searchParams.get("headers"));
const headers = {
  Accept: "*/*",
  Referer: hdr.referer,
  Origin: hdr.origin,
  "User-Agent": "Mozilla/5.0",
};
const masterRes = await fetch(master, { headers });
console.log("master status:", masterRes.status);
if (masterRes.ok) {
  const text = await masterRes.text();
  console.log(text.slice(0, 1500));
  const segLine = text.split("\n").find((l) => l.trim() && !l.startsWith("#"));
  if (segLine) console.log("sample segment ref:", segLine.slice(0, 200));
}
