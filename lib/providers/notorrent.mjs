import { fetchTmdbDetails } from "../tmdb.mjs";

const NOTORRENT_API = "https://addon-osvh.onrender.com";

function cleanText(str) {
  if (!str) {
    return "";
  }
  return str.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu, "").trim();
}

function extractQuality(titleText) {
  const raw = titleText || "";
  const match = raw.match(/(\d{3,4}p)/);
  if (match) {
    return match[0];
  }
  if (raw.toUpperCase().includes("FREE")) {
    return "Auto";
  }
  return "Unknown";
}

function detectFormat(url) {
  if (/\.mp4(\?|$)/i.test(url)) {
    return "mp4";
  }
  if (/\.m3u8(\?|$)/i.test(url)) {
    return "m3u8";
  }
  if (/\.mkv(\?|$)/i.test(url)) {
    return "mkv";
  }
  return "file";
}

export async function getNotorrentStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  const details = await fetchTmdbDetails(tmdbId, mediaType === "tv" ? "tv" : "movie");
  const imdbId = details.imdbId;

  if (!imdbId) {
    return [];
  }

  const apiUrl =
    mediaType === "tv" && seasonNum != null
      ? `${NOTORRENT_API}/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`
      : `${NOTORRENT_API}/stream/movie/${imdbId}.json`;

  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const rawList = data.streams || [];
  const streams = [];

  for (const item of rawList) {
    if (item.externalUrl || !item.url) {
      continue;
    }
    if (item.url.includes("github.com") || item.url.includes("googleusercontent")) {
      continue;
    }

    const cleanTitleStr = cleanText(item.title || "");
    const quality = extractQuality(cleanTitleStr);
    const proxyHeaders = item.behaviorHints?.proxyHeaders?.request || {};
    const headers = { ...(item.behaviorHints?.headers || {}), ...proxyHeaders };
    const format = detectFormat(item.url);

    streams.push({
      title: cleanTitleStr || quality,
      url: item.url,
      quality: quality.replace(/p/i, "") || "auto",
      provider: "notorrent",
      format,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
  }

  return streams;
}
