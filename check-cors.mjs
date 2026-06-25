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
const hdr = JSON.parse(new URL(master).searchParams.get("headers"));

for (const label of ["master", "quality"]) {
  const url =
    label === "master"
      ? master
      : master.replace(/\/playlist\.m3u8/i, "/1080/index.m3u8");
  const r = await fetch(url, {
    headers: {
      Accept: "*/*",
      Referer: hdr.referer,
      Origin: hdr.origin,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  console.log(`\n${label}: ${r.status}`);
  console.log("  ACAO:", r.headers.get("access-control-allow-origin"));
  console.log("  ACAC:", r.headers.get("access-control-allow-credentials"));
  if (r.ok) {
    const text = await r.text();
    console.log("  preview:", text.slice(0, 120).replace(/\n/g, " "));
  }
}
