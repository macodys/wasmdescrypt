function encodeHdr(headers) {
  if (!headers || Object.keys(headers).length === 0) {
    return null;
  }
  return Buffer.from(JSON.stringify(headers)).toString("base64url");
}

export function decodeHdr(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export function isAllowedProxyUrl(target) {
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveMediaUrl(relativeOrAbsolute, baseUrl) {
  const base = new URL(baseUrl);
  const resolved = new URL(relativeOrAbsolute, baseUrl);

  if (base.search) {
    const merged = new URLSearchParams(resolved.search);
    for (const [key, value] of base.searchParams.entries()) {
      if (!merged.has(key)) {
        merged.set(key, value);
      }
    }
    resolved.search = merged.toString();
  }

  return resolved.toString();
}

export function buildUpstreamHeaders(targetUrl, extraHeaders = {}) {
  const headers = {
    Accept: "*/*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...extraHeaders,
  };

  try {
    const parsed = new URL(targetUrl);
    const headersParam = parsed.searchParams.get("headers");
    if (headersParam) {
      const custom = JSON.parse(headersParam);
      if (custom.referer) {
        headers.Referer = custom.referer;
      }
      if (custom.origin) {
        headers.Origin = custom.origin;
      }
    }

    const hostParam = parsed.searchParams.get("host");
    if (hostParam) {
      try {
        headers.Host = new URL(hostParam).host;
      } catch {
        // ignore malformed host param
      }
    }
  } catch {
    // ignore malformed headers param
  }

  return headers;
}

export function wrapPlayableUrl(upstreamUrl, { baseOrigin, headers } = {}) {
  if (!baseOrigin || !upstreamUrl) {
    return upstreamUrl;
  }

  const params = new URLSearchParams({ url: upstreamUrl });
  const hdr = encodeHdr(headers);
  if (hdr) {
    params.set("hdr", hdr);
  }

  return `${baseOrigin}/api/proxy?${params.toString()}`;
}

export function isStormHlsUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("vodvidl.site") && /\.m3u8(\?|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

const STORM_VLC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function quoteVlcValue(value) {
  if (!value) {
    return '""';
  }
  if (/[\s"]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function parseStormPlaybackHeaders(upstreamUrl) {
  let referer = "https://megacloud.live/";

  try {
    const parsed = new URL(upstreamUrl);
    const headersParam = parsed.searchParams.get("headers");
    if (headersParam) {
      const custom = JSON.parse(headersParam);
      if (custom.referer) {
        referer = custom.referer;
      }
    }
  } catch {
    // keep default referer
  }

  return {
    referer,
    userAgent: STORM_VLC_USER_AGENT,
  };
}

export function buildStormVlcMrl(upstreamUrl) {
  if (!upstreamUrl) {
    return null;
  }

  const { referer, userAgent } = parseStormPlaybackHeaders(upstreamUrl);
  return `:http-user-agent=${quoteVlcValue(userAgent)} :http-referrer=${quoteVlcValue(referer)} ${upstreamUrl}`;
}

export function buildStormVlcM3u(upstreamUrl) {
  if (!upstreamUrl) {
    return null;
  }

  const { referer, userAgent } = parseStormPlaybackHeaders(upstreamUrl);

  return [
    "#EXTM3U",
    `#EXTVLCOPT:http-user-agent=${quoteVlcValue(userAgent)}`,
    `#EXTVLCOPT:http-referrer=${quoteVlcValue(referer)}`,
    "#EXTINF:-1,Stream",
    upstreamUrl,
    "",
  ].join("\n");
}

export function buildStormVlcCommand(upstreamUrl) {
  if (!upstreamUrl) {
    return null;
  }

  const { referer, userAgent } = parseStormPlaybackHeaders(upstreamUrl);
  const args = [
    `--http-referrer=${quoteVlcValue(referer)}`,
    `--http-user-agent=${quoteVlcValue(userAgent)}`,
    quoteVlcValue(upstreamUrl),
  ];
  return `"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" ${args.join(" ")}`;
}

export function rewriteM3u8(content, baseUrl, proxyBase) {
  const prefix = proxyBase || "/api/proxy?url=";

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
          const absolute = resolveMediaUrl(uri, baseUrl);
          const proxied =
            typeof prefix === "string" && prefix.includes("?url=")
              ? `${prefix}${encodeURIComponent(absolute)}`
              : `${prefix}${encodeURIComponent(absolute)}`;
          return `URI="${proxied}"`;
        });
      }

      if (trimmed.startsWith("#")) {
        return line;
      }

      const absolute = resolveMediaUrl(trimmed, baseUrl);
      return typeof prefix === "string" && prefix.includes("?url=")
        ? `${prefix}${encodeURIComponent(absolute)}`
        : `/api/proxy?url=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}

function pickResponseHeaders(upstreamHeaders) {
  const out = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  };

  for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstreamHeaders.get(key);
    if (value) {
      out[key] = value;
    }
  }

  return out;
}

export async function proxyMediaRequest(targetUrl, hdrParam, incomingHeaders, writeResponse) {
  if (!targetUrl) {
    writeResponse(400, { "Content-Type": "text/plain" }, "Missing url");
    return;
  }

  if (!isAllowedProxyUrl(targetUrl)) {
    writeResponse(403, { "Content-Type": "text/plain" }, "Forbidden");
    return;
  }

  const extra = decodeHdr(hdrParam);
  const upstreamHeaders = buildUpstreamHeaders(targetUrl, extra);

  if (incomingHeaders?.range) {
    upstreamHeaders.Range = incomingHeaders.range;
  }

  const response = await fetch(targetUrl, { headers: upstreamHeaders });

  if (!response.ok && response.status !== 206) {
    writeResponse(response.status, { "Content-Type": "text/plain" }, `Upstream error (${response.status})`);
    return;
  }

  const contentType = response.headers.get("content-type") || "";
  const isManifest =
    targetUrl.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("m3u8");

  if (isManifest) {
    const host = incomingHeaders?.host || "localhost";
    const proto = incomingHeaders?.proto || "https";
    const proxyBase = `${proto}://${host}/api/proxy?url=`;
    const text = await response.text();
    const rewritten = rewriteM3u8(text, targetUrl, proxyBase);

    writeResponse(
      200,
      {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
      rewritten
    );
    return;
  }

  const headers = pickResponseHeaders(response.headers);
  const body = Buffer.from(await response.arrayBuffer());
  writeResponse(response.status, headers, body);
}

export function applyProxyToLinkResponse(body, { baseOrigin, proxy, streamHeaders }) {
  const result = { ...body };
  delete result.headers;

  const stormHls =
    body.streamType === "hls" &&
    (isStormHlsUrl(body.url) || isStormHlsUrl(body.qualityUrl));

  if (stormHls) {
    const upstream = body.qualityUrl || body.url;
    const vlcMrl = buildStormVlcMrl(upstream);
    const vlcPlaylist = buildStormVlcM3u(upstream);
    const vlcCommand = buildStormVlcCommand(upstream);
    const vlcPlaylistUrl =
      baseOrigin
        ? `${baseOrigin}/api/vlc?${new URLSearchParams({
            id: body.id || body.tmdbId || "",
            type: body.type || "movie",
            ...(body.season ? { season: String(body.season) } : {}),
            ...(body.episode ? { episode: String(body.episode) } : {}),
            source: "vidlink",
          }).toString()}`
        : null;

    return {
      ...result,
      rawUrl: body.url,
      rawQualityUrl: body.qualityUrl,
      url: upstream,
      qualityUrl: body.qualityUrl,
      master: body.master,
      vlcMrl,
      vlcUrl: vlcMrl,
      vlcPlaylist,
      vlcPlaylistUrl,
      vlcCommand,
      playable: true,
      proxyMode: "client",
      playbackHint:
        "Storm HLS in VLC: (1) save vlcPlaylist as stream.m3u and open the file, (2) run vlcCommand in cmd, or (3) paste vlcMrl in Open Network Stream. Do not use url/qualityUrl directly. Links expire after a few hours.",
    };
  }

  if (!proxy || !baseOrigin) {
    return result;
  }

  const hdr = streamHeaders || body.headers || null;
  const wrap = (url) => (url ? wrapPlayableUrl(url, { baseOrigin, headers: hdr }) : url);

  const proxied = {
    ...result,
    rawUrl: body.url,
    url: wrap(body.url),
    master: body.master ? wrap(body.master) : body.master,
    qualityUrl: body.qualityUrl ? wrap(body.qualityUrl) : body.qualityUrl,
    playable: true,
    proxyMode: "server",
  };

  if (body.qualities && typeof body.qualities === "object") {
    proxied.rawQualities = body.qualities;
    proxied.qualities = Object.fromEntries(
      Object.entries(body.qualities).map(([key, value]) => [key, wrap(value)])
    );
  }

  if (Array.isArray(body.alternates)) {
    proxied.rawAlternates = body.alternates;
    proxied.alternates = body.alternates.map((item) => ({
      ...item,
      rawUrl: item.url,
      url: wrap(item.url),
    }));
  }

  if (body.streamType === "hls") {
    proxied.playbackHint =
      "Use the proxied url field in players that support HLS. Regenerate via /api/link when the link expires.";
  }

  return proxied;
}
