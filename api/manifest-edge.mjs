export const config = {
  runtime: "edge",
};

function buildUpstreamHeaders(targetUrl) {
  const headers = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };

  try {
    const parsed = new URL(targetUrl);
    const headersParam = parsed.searchParams.get("headers");
    if (headersParam) {
      const custom = JSON.parse(headersParam);
      if (custom.referer) headers.Referer = custom.referer;
      if (custom.origin) headers.Origin = custom.origin;
    }
  } catch {}

  return headers;
}

function isStormHlsUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("vodvidl.site") && /\.m3u8(\?|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function rewriteM3u8(content, baseUrl, proxyBase) {
  const prefix = proxyBase || "/api/proxy?url=";
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return line;

      const absolute = new URL(trimmed, baseUrl).toString();
      const proxied = `${prefix}${encodeURIComponent(absolute)}`;
      return proxied;
    })
    .join("\n");
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const baseOrigin = `${url.protocol}//${url.host}`;
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response("Missing id parameter", { status: 400 });
    }

    const linkUrl = `${baseOrigin}/api/link?${url.searchParams.toString()}&proxy=0&source=vidlink`;
    const linkRes = await fetch(linkUrl);
    const body = await linkRes.json();

    if (!linkRes.ok || body.streamType !== "hls") {
      return new Response("No HLS stream available.", { status: 404 });
    }

    const upstream = body.streamQualityUrl || body.rawQualityUrl || body.rawUrl || body.streamUrl;
    if (!upstream || !isStormHlsUrl(upstream)) {
      return new Response("No Storm HLS manifest found.", { status: 404 });
    }

    const stormRes = await fetch(upstream, {
      headers: buildUpstreamHeaders(upstream),
    });

    if (!stormRes.ok) {
      return new Response(
        `Storm fetch returned ${stormRes.status}. Edge IP may also be blocked. Try a residential proxy.`,
        { status: stormRes.status }
      );
    }

    const text = await stormRes.text();
    if (!text.trimStart().startsWith("#EXTM3U")) {
      return new Response("Invalid manifest response.", { status: 502 });
    }

    const proxyBase = `${baseOrigin}/api/proxy?url=`;
    const rewritten = rewriteM3u8(text, upstream, proxyBase);

    return new Response(rewritten, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "X-Vercel-Runtime": "edge",
      },
    });
  } catch (error) {
    return new Response(error.message || "Manifest request failed", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}