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

const advToken = globalThis.getAdv("786892");
console.log("advToken", advToken);

const url = `https://vidlink.pro/api/b/movie/${encodeURIComponent(advToken)}?multiLang=0`;
console.log("fetching", url);

const res = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://vidlink.pro/movie/786892",
  },
});

console.log("status", res.status);
const text = await res.text();
console.log("body", text.slice(0, 5000));

try {
  const json = JSON.parse(text);
  console.log("keys", Object.keys(json));
  console.log(JSON.stringify(json, null, 2).slice(0, 8000));
} catch {
  // not json
}
