import { proxyMediaRequest } from "../lib/media-proxy.mjs";

function sendOptions(res) {
  res.statusCode = 204;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.end();
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    sendOptions(res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url = new URL(req.url, `${proto}://${host}`);
    const targetUrl = url.searchParams.get("url");
    const hdrParam = url.searchParams.get("hdr");

    await proxyMediaRequest(
      targetUrl,
      hdrParam,
      {
        range: req.headers.range,
        host,
        proto,
      },
      (status, headers, body) => {
        res.statusCode = status;
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value);
        }
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(body);
      }
    );
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message }));
  }
}
