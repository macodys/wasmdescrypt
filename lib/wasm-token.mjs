import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let initPromise = null;

async function initWasm() {
  if (!globalThis.performance?.now) {
    globalThis.performance = { now: () => Date.now() };
  }

  eval(fs.readFileSync(path.join(root, "wasm_exec.js"), "utf8"));

  const sodiumMod = await import("libsodium-wrappers");
  await sodiumMod.default.ready;
  globalThis.sodium = sodiumMod.default;

  const go = new globalThis.Dm();
  const wasmBytes = fs.readFileSync(path.join(root, "fu.wasm"));
  const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
  go.run(instance).catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (typeof globalThis.getAdv !== "function") {
    throw new Error("WASM getAdv API did not initialize");
  }
}

export async function generateToken(contentId) {
  if (!initPromise) {
    initPromise = initWasm();
  }

  await initPromise;

  const token = globalThis.getAdv(String(contentId).trim());
  if (!token) {
    throw new Error("getAdv returned an empty token");
  }

  return token;
}
