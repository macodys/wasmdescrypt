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

async function probe(label, id, opts = {}) {
  const token = globalThis.getAdv(String(id));
  const params = new URLSearchParams({ token, multiLang: "0" });
  if (opts.type === "tv") {
    params.set("type", "tv");
    params.set("season", String(opts.season ?? 1));
    params.set("episode", String(opts.episode ?? 1));
  }
  const res = await fetch(`http://localhost:3000/api/stream?${params}`);
  const data = await res.json();
  const stream = data?.stream ?? {};
  console.log(`\n=== ${label} (id ${id}) ===`);
  console.log("type:", stream.type);
  console.log("keys:", Object.keys(stream));
  if (stream.playlist) {
    console.log("playlist:", stream.playlist.slice(0, 120) + "...");
  }
  if (stream.qualities) {
    console.log("qualities:", Object.keys(stream.qualities));
    const first = stream.qualities[Object.keys(stream.qualities)[0]];
    console.log("sample url:", first?.url?.slice(0, 120) + "...");
  }
  return data;
}

await probe("TV HLS", 76479, { type: "tv", season: 1, episode: 1 });
await probe("MP4 movie", 1439930);
