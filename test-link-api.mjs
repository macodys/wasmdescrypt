const base = process.env.API_BASE || "http://localhost:3000";

async function testLink(label, path) {
  const url = `${base}${path}`;
  const response = await fetch(url);
  const body = await response.json();
  console.log(`\n=== ${label} ===`);
  console.log("status:", response.status);
  console.log("streamType:", body.streamType, "source:", body.source);
  if (body.url) console.log("url:", body.url.slice(0, 120) + "...");
  if (body.error) console.log("error:", body.error);
}

await testLink("Deadpool TMDB MP4-first", "/api/link?id=533535&format=auto");
await testLink("Deadpool IMDb MP4-first", "/api/link?id=tt6263850&format=auto");
await testLink("VidLink HLS only", "/api/link?id=533535&format=hls&source=vidlink");
await testLink("MP4 known VidLink", "/api/link?id=1439930&source=vidlink");
