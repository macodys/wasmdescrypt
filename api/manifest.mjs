import { handleLinkRequest } from "../lib/link-handler.mjs";
import { buildUpstreamHeaders, fetchUpstream, getStormProxyStatus, isStormHlsUrl, rewriteM3u8 } from "../lib/media-proxy.mjs";
import { pickHlsSourceUrl } from "../lib/storm-hls.mjs";

function sendText(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(body);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
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
    const baseOrigin = `${proto}://${host}`;
    const url = new URL(req.url, baseOrigin);
    const params = new URLSearchParams(url.searchParams);
    params.set("source", "vidlink");
    params.set("format", "hls");
    params.set("proxy", "0");

    const body = await handleLinkRequest(params, { baseOrigin });

    if (body.streamType !== "hls") {
      sendText(res, 404, "No HLS stream available for this title.");
      return;
    }

    const upstream = pickHlsSourceUrl(body);
    if (!upstream || !isStormHlsUrl(upstream)) {
      sendText(res, 404, "Manifest helper only supports Storm HLS links.");
      return;
    }

    const upstreamHeaders = buildUpstreamHeaders(upstream);
    const response = await fetchUpstream(upstream, { headers: upstreamHeaders });

    if (!response.ok) {
      sendText(
        res,
        response.status,
        `Upstream manifest error (${response.status}). Storm blocked the server fetch — set STORM_PROXY_URL on Vercel or use downloadUrl for VLC.`
      );
      return;
    }

    const text = await response.text();
    const proxyBase = `${baseOrigin}/api/proxy?url=`;
    const rewritten = rewriteM3u8(text, upstream, proxyBase);

    sendText(res, 200, rewritten, {
      "X-Storm-Proxy": getStormProxyStatus().active ? "active" : "direct",
    });
  } catch (error) {
    sendText(res, error.status || 502, error.message || "Manifest request failed");
  }
}
