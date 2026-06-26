import { getDahmermoviesStreams } from "./providers/dahmermovies.mjs";
import { getNotorrentStreams } from "./providers/notorrent.mjs";
import { getTmdbApiKey } from "./tmdb.mjs";

const MP4_PROVIDERS = [
  { name: "dahmermovies", fetch: getDahmermoviesStreams },
  { name: "notorrent", fetch: getNotorrentStreams },
];

function qualityScore(label, targetQuality) {
  const target = Number(targetQuality);
  const match = String(label).match(/(\d{3,4})/);
  const value = match ? Number(match[1]) : 0;

  if (!Number.isFinite(target) || !value) {
    return value;
  }

  return 1000 - Math.abs(value - target);
}

function isMp4Stream(stream) {
  if (stream.format === "mp4") {
    return true;
  }
  return /\.mp4(\?|$)/i.test(stream.url);
}

function isDirectFile(stream) {
  if (isMp4Stream(stream)) {
    return true;
  }
  return /\.(mkv|webm|avi)(\?|$)/i.test(stream.url);
}

export function pickBestStream(streams, { quality, mp4Only = true }) {
  const pool = mp4Only ? streams.filter(isMp4Stream) : streams.filter(isDirectFile);
  if (pool.length === 0) {
    return null;
  }

  pool.sort((a, b) => qualityScore(b.quality || b.title, quality) - qualityScore(a.quality || a.title, quality));
  return pool[0];
}

export async function fetchEmbedMp4Streams(options) {
  if (!getTmdbApiKey()) {
    return { streams: [], providers: [] };
  }

  const { tmdbId, type, season, episode } = options;
  const mediaType = type === "tv" ? "tv" : "movie";
  const seasonNum = type === "tv" ? Number(season) : null;
  const episodeNum = type === "tv" ? Number(episode) : null;

  const results = await Promise.all(
    MP4_PROVIDERS.map(async (provider) => {
      try {
        const streams = await provider.fetch(tmdbId, mediaType, seasonNum, episodeNum);
        return { provider: provider.name, streams };
      } catch {
        return { provider: provider.name, streams: [] };
      }
    })
  );

  const streams = results.flatMap((r) => r.streams);
  return { streams, providers: results.map((r) => ({ name: r.provider, count: r.streams.length })) };
}

export function embedStreamToResponse(stream, meta) {
  const qualityUsed = String(stream.quality || "1080").replace(/p/i, "");

  return {
    streamType: "mp4",
    source: stream.provider,
    url: stream.url,
    master: null,
    qualityUrl: stream.url,
    qualities: null,
    qualityUsed,
    title: stream.title,
    headers: stream.headers || null,
    tmdbId: meta.tmdbId,
    imdbId: meta.imdbId || undefined,
  };
}
