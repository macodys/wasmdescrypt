import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchVidLinkStream } from "./lib/stream-core.mjs";
import { generateToken } from "./lib/wasm-token.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

async function probe(label, id, opts = {}) {
  const token = await generateToken(String(id));
  const data = await fetchVidLinkStream(token, opts.multiLang ?? false, {
    type: opts.type ?? "movie",
    season: opts.season ?? "1",
    episode: opts.episode ?? "1",
  });
  const s = data?.stream ?? {};
  console.log(`\n=== ${label} ===`);
  console.log("type:", s.type);
  console.log("keys:", Object.keys(s));
  if (s.qualities) console.log("quality keys:", Object.keys(s.qualities));
  if (s.playlist) console.log("playlist host:", new URL(s.playlist).hostname);
  return data;
}

// HLS movie (Deadpool TMDB id)
await probe("HLS movie 533535", 533535);

// MP4 movie (known file type)
await probe("MP4 movie 1439930", 1439930);

// HLS TV
await probe("HLS TV 76479 S1E1", 76479, { type: "tv", season: "1", episode: "1" });

// Try multiLang on HLS title
const token533 = await generateToken("533535");
const ml = await fetchVidLinkStream(token533, true, { type: "movie", season: "1", episode: "1" });
console.log("\n=== 533535 multiLang=1 ===");
console.log("type:", ml?.stream?.type, "qualities?", !!ml?.stream?.qualities);

// Fetch master m3u8 if possible
const master = (await probe("refetch 533535", 533535))?.stream?.playlist;
if (master) {
  const hdr = JSON.parse(new URL(master).searchParams.get("headers"));
  const res = await fetch(master, {
    headers: { Referer: hdr.referer, Origin: hdr.origin, Accept: "*/*" },
  });
  console.log("\nmaster fetch:", res.status);
  if (res.ok) {
    const text = await res.text();
    console.log(text.slice(0, 2000));
    const exts = [...text.matchAll(/\.(ts|m4s|mp4|m3u8)/gi)].map((m) => m[0].toLowerCase());
    console.log("segment extensions:", [...new Set(exts)]);
  }
}
