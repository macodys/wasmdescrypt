import { handleLinkRequest } from "../lib/link-handler.mjs";
import { buildStormVlcM3u, isStormHlsUrl } from "../lib/media-proxy.mjs";

function sendText(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(body);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url = new URL(req.url, `${proto}://${host}`);
    const params = new URLSearchParams(url.searchParams);
    params.set("format", "hls");
    params.set("source", "vidlink");
    params.set("proxy", "0");

    const body = await handleLinkRequest(params, { baseOrigin: `${proto}://${host}` });

    if (body.streamType !== "hls") {
      sendText(res, 404, "No HLS stream available for this title.");
      return;
    }

    const upstream = body.qualityUrl || body.url;
    if (!isStormHlsUrl(upstream)) {
      sendText(res, 404, "VLC playlist helper only supports Storm HLS links.");
      return;
    }

    const playlist = buildStormVlcM3u(upstream);
    if (!playlist) {
      sendText(res, 404, "Could not build VLC playlist.");
      return;
    }

    sendText(res, 200, playlist, {
      "Content-Disposition": 'inline; filename="stream.m3u8"',
      "Cache-Control": "no-cache",
    });
  } catch (error) {
    sendText(res, error.status || 502, error.message || "Request failed");
  }
}
