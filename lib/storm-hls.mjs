export function isStormUrl(url) {
  if (!url) {
    return false;
  }

  try {
    return new URL(url).hostname.includes("vodvidl.site");
  } catch {
    return false;
  }
}

export function parseStormHeaders(url) {
  try {
    const headersParam = new URL(url).searchParams.get("headers");
    if (!headersParam) {
      return {};
    }
    return JSON.parse(headersParam);
  } catch {
    return {};
  }
}

export function extractStormRequestHeaders(upstreamUrl) {
  const storm = parseStormHeaders(upstreamUrl);
  return {
    Referer: storm.referer || "https://megacloud.live/",
    Origin: storm.origin || "https://megacloud.live",
  };
}

export function resolveStormMediaUrl(relativeOrAbsolute, baseUrl) {
  const base = new URL(baseUrl);
  const resolved = new URL(relativeOrAbsolute, baseUrl);

  for (const [key, value] of base.searchParams.entries()) {
    if (!resolved.searchParams.has(key)) {
      resolved.searchParams.set(key, value);
    }
  }

  return resolved.toString();
}

export function rewriteStormManifestForClient(content, baseUrl) {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
          return `URI="${resolveStormMediaUrl(uri, baseUrl)}"`;
        });
      }

      if (trimmed.startsWith("#")) {
        return line;
      }

      return resolveStormMediaUrl(trimmed, baseUrl);
    })
    .join("\n");
}

export function createStormHlsConfig(basePlaylistUrl) {
  const baseHeaders = parseStormHeaders(basePlaylistUrl);

  return {
    enableWorker: true,
    lowLatencyMode: false,
    fetchSetup(_context, initParams) {
      initParams.referrerPolicy = "no-referrer";
      initParams.credentials = "omit";
      initParams.mode = "cors";
      return initParams;
    },
    xhrSetup(xhr, requestUrl) {
      const resolvedUrl = resolveStormMediaUrl(requestUrl, basePlaylistUrl);
      const requestHeaders = parseStormHeaders(resolvedUrl);

      if (requestHeaders.referer || baseHeaders.referer) {
        xhr.setRequestHeader("Referer", requestHeaders.referer || baseHeaders.referer);
      }
      if (requestHeaders.origin || baseHeaders.origin) {
        xhr.setRequestHeader("Origin", requestHeaders.origin || baseHeaders.origin);
      }
    },
  };
}

export function pickHlsSourceUrl(data) {
  return data.plugin?.m3u8 || data.streamQualityUrl || data.rawQualityUrl || data.streamUrl || data.rawUrl;
}
