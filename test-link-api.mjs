const base = process.env.API_BASE || "http://localhost:3000";

async function testLink(path) {
  const url = `${base}${path}`;
  const response = await fetch(url);
  const body = await response.json();
  console.log(`\nGET ${path}`);
  console.log("status:", response.status);
  console.log(JSON.stringify(body, null, 2));
}

await testLink("/api/link?id=1439930");
await testLink("/api/link?id=76479&type=tv&season=1&episode=1");
