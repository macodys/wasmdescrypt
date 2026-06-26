const base = process.env.API_BASE || "http://localhost:3000";

async function testLink(label, path) {
  const url = `${base}${path}`;
  const response = await fetch(url);
  const body = await response.json();
  console.log(`\n=== ${label} ===`);
  console.log("status:", response.status);
  console.log("streamType:", body.streamType, "source:", body.source, "playable:", body.playable);
  if (body.url) console.log("url:", body.url.slice(0, 140) + "...");
  if (body.error) console.log("error:", body.error);
}

await testLink("VidLink auto", "/api/link?id=533535");
await testLink("VidLink HLS", "/api/link?id=533535&format=hls");
await testLink("VidLink MP4", "/api/link?id=1439930&format=mp4");
await testLink("Proxied MP4", "/api/link?id=1439930");
await testLink("Raw upstream", "/api/link?id=1439930&proxy=0");
await testLink("Embed disabled", "/api/link?id=533535&source=embed");
