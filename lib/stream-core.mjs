export const VIDLINK_ORIGIN = "https://vidlink.pro";

export function toQualityPlaylistUrl(masterPlaylistUrl, quality) {
  const url = new URL(masterPlaylistUrl);
  url.pathname = url.pathname.replace(/\/playlist\.m3u8$/i, `/${quality}/index.m3u8`);
  return url.toString();
}

export function pickQualityEntry(qualities, quality) {
  const keys = Object.keys(qualities).sort((a, b) => Number(b) - Number(a));
  if (keys.length === 0) {
    return null;
  }

  if (qualities[quality]?.url) {
    return { key: quality, entry: qualities[quality] };
  }

  const fallbackKey =
    keys.find((key) => Number(key) <= Number(quality)) || keys[keys.length - 1];

  return { key: fallbackKey, entry: qualities[fallbackKey] };
}

export function validateHlsUrl(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, message: "URL is not valid." };
  }

  if (parsed.pathname.includes("%2F") || parsed.pathname.includes("%2f")) {
    return {
      valid: false,
      message:
        "HLS URL path is over-encoded. Use type=tv with season and episode for TV content.",
    };
  }

  if (!parsed.pathname.includes(".m3u8")) {
    return { valid: false, message: "URL is not an m3u8 playlist." };
  }

  if (parsed.hostname.includes("vodvidl.site")) {
    if (!parsed.searchParams.has("auth")) {
      return {
        valid: false,
        message: "HLS URL is missing auth=. Regenerate with the correct content type.",
      };
    }

    if (!/^\/proxy\/wiwii\/[a-f0-9]+\//i.test(parsed.pathname)) {
      return {
        valid: false,
        message: "Storm proxy path looks invalid.",
      };
    }
  }

  return { valid: true, message: "" };
}

export function isBrokenHlsPlaylist(url) {
  if (!url) {
    return true;
  }

  return !validateHlsUrl(url).valid;
}

export function resolveStreamLinks(data, quality) {
  const stream = data?.stream;
  if (!stream) {
    throw new Error("Stream response did not include stream data");
  }

  if (stream.type === "hls") {
    if (!stream.playlist) {
      throw new Error("HLS stream did not include a playlist URL");
    }

    const check = validateHlsUrl(stream.playlist);
    if (!check.valid) {
      throw new Error(check.message);
    }

    const qualityUrl = toQualityPlaylistUrl(stream.playlist, quality);

    return {
      streamType: "hls",
      url: stream.playlist,
      master: stream.playlist,
      qualityUrl,
      qualities: null,
      qualityUsed: quality,
    };
  }

  if (stream.type === "file" && stream.qualities) {
    const picked = pickQualityEntry(stream.qualities, quality);
    if (!picked?.entry?.url) {
      throw new Error("MP4 stream did not include any quality URLs");
    }

    const qualities = Object.fromEntries(
      Object.keys(stream.qualities)
        .sort((a, b) => Number(b) - Number(a))
        .map((key) => [key, stream.qualities[key].url])
    );

    return {
      streamType: "mp4",
      url: picked.entry.url,
      master: null,
      qualityUrl: picked.entry.url,
      qualities,
      qualityUsed: picked.key,
    };
  }

  throw new Error(`Unsupported stream type: ${stream.type || "unknown"}`);
}

export async function fetchVidLinkStream(token, multiLang, options) {
  const multiLangParam = multiLang ? 1 : 0;
  let apiUrl;
  let referer;

  if (options.type === "tv") {
    if (!options.season || !options.episode) {
      throw new Error("TV streams require season and episode");
    }
    apiUrl = `${VIDLINK_ORIGIN}/api/b/tv/${encodeURIComponent(token)}/${encodeURIComponent(options.season)}/${encodeURIComponent(options.episode)}?multiLang=${multiLangParam}`;
    referer = `${VIDLINK_ORIGIN}/tv/0/${options.season}/${options.episode}`;
  } else {
    apiUrl = `${VIDLINK_ORIGIN}/api/b/movie/${encodeURIComponent(token)}?multiLang=${multiLangParam}`;
    referer = `${VIDLINK_ORIGIN}/`;
  }

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: referer,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`VidLink API error (${response.status}): ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

export async function fetchStreamData(token, multiLang, options) {
  let data = await fetchVidLinkStream(token, multiLang, options);

  const playlist = data?.stream?.playlist;
  if (
    options.type === "movie" &&
    data?.stream?.type === "hls" &&
    isBrokenHlsPlaylist(playlist)
  ) {
    data = await fetchVidLinkStream(token, multiLang, {
      type: "tv",
      season: options.season || "1",
      episode: options.episode || "1",
    });
  }

  if (data?.stream?.type === "hls" && isBrokenHlsPlaylist(data?.stream?.playlist)) {
    throw new Error(
      "This ID looks like a TV series. Use type=tv with season and episode query parameters."
    );
  }

  return data;
}

export function parseLinkQuery(searchParams) {
  const id = searchParams.get("id") || searchParams.get("contentId");
  if (!id?.trim()) {
    const error = new Error("Missing id query parameter");
    error.status = 400;
    throw error;
  }

  const season = searchParams.get("season");
  const episode = searchParams.get("episode");
  const typeParam = searchParams.get("type");
  const type =
    typeParam === "tv" || (season && episode) ? "tv" : typeParam === "movie" ? "movie" : "movie";

  if (type === "tv" && (!season || !episode)) {
    const error = new Error("TV streams require season and episode query parameters");
    error.status = 400;
    throw error;
  }

  const quality = searchParams.get("quality") || "1080";
  const multiLang =
    searchParams.get("multiLang") === "1" || searchParams.get("multiLang") === "true";
  const format = searchParams.get("format") || "auto";
  const source = searchParams.get("source") || "auto";
  const proxyParam = searchParams.get("proxy");
  const proxy = proxyParam !== "0" && proxyParam !== "false";

  return {
    id: id.trim(),
    type,
    season: season || "1",
    episode: episode || "1",
    quality,
    multiLang,
    format,
    source,
    proxy,
  };
}
