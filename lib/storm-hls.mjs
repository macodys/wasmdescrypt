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

export function createStormHlsConfig() {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    xhrSetup(xhr, url) {
      const storm = parseStormHeaders(url);
      if (storm.referer) {
        xhr.setRequestHeader("Referer", storm.referer);
      }
      if (storm.origin) {
        xhr.setRequestHeader("Origin", storm.origin);
      }
    },
  };
}

export function pickHlsSourceUrl(data) {
  return data.rawQualityUrl || data.qualityUrl || data.rawUrl || data.url;
}
