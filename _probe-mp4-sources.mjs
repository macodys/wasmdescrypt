import { fetchVidLinkStream } from "./lib/stream-core.mjs";
import { generateToken } from "./lib/wasm-token.mjs";

const ids = [
  ["MP4 known", "1439930"],
  ["HLS known", "533535"],
  ["HLS known", "786892"],
  ["HLS TV", "76479"],
];

for (const [label, id] of ids) {
  const token = await generateToken(id);
  const data = await fetchVidLinkStream(token, false, {
    type: id === "76479" ? "tv" : "movie",
    season: "1",
    episode: "1",
  });
  const s = data?.stream ?? {};
  console.log(`${label} ${id}: type=${s.type}`, s.qualities ? Object.keys(s.qualities) : s.playlist?.slice(0, 60));
}

// Probe alternate VidLink paths for HLS id
const token = await generateToken("533535");
const paths = [
  `/api/b/movie/${encodeURIComponent(token)}?multiLang=0`,
  `/api/b/movie/${encodeURIComponent(token)}?multiLang=0&format=mp4`,
  `/api/b/movie/${encodeURIComponent(token)}?multiLang=0&quality=1080`,
  `/api/stream/movie/${encodeURIComponent(token)}`,
  `/api/movie/533535/stream`,
  `/api/movie/533535?multiLang=0`,
];

for (const p of paths) {
  const res = await fetch(`https://vidlink.pro${p}`, {
    headers: { Referer: "https://vidlink.pro/", Accept: "application/json" },
  });
  const text = await res.text();
  const preview = text.slice(0, 120).replace(/\s+/g, " ");
  console.log(`\n${p}\n  ${res.status} ${preview}`);
}
