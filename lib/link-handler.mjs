import { fetchStreamData, parseLinkQuery, resolveStreamLinks } from "./stream-core.mjs";
import { embedStreamToResponse, fetchEmbedMp4Streams, pickBestStream } from "./embed-api.mjs";
import { applyProxyToLinkResponse } from "./media-proxy.mjs";
import { generateToken } from "./wasm-token.mjs";
import { resolveContentId } from "./tmdb.mjs";

function finalizeResponse(body, query, options) {
  return applyProxyToLinkResponse(body, {
    baseOrigin: options.baseOrigin,
    proxy: query.proxy,
    streamHeaders: body.headers,
  });
}

async function fetchVidlinkLinks(query) {
  const token = await generateToken(query.tmdbId);
  const streamData = await fetchStreamData(token, query.multiLang, {
    type: query.type,
    season: query.season,
    episode: query.episode,
  });
  const links = resolveStreamLinks(streamData, query.quality);

  return {
    id: query.originalId,
    tmdbId: query.tmdbId,
    imdbId: query.imdbId || undefined,
    type: query.type,
    season: query.type === "tv" ? Number(query.season) : undefined,
    episode: query.type === "tv" ? Number(query.episode) : undefined,
    quality: query.quality,
    qualityUsed: links.qualityUsed,
    multiLang: query.multiLang,
    streamType: links.streamType,
    source: "vidlink",
    url: links.url,
    master: links.master,
    qualityUrl: links.qualityUrl,
    qualities: links.qualities,
    token,
  };
}

async function fetchEmbedLinks(query) {
  const { streams, providers } = await fetchEmbedMp4Streams({
    tmdbId: query.tmdbId,
    type: query.type,
    season: query.season,
    episode: query.episode,
  });

  const best = pickBestStream(streams, { quality: query.quality, mp4Only: true });
  if (!best) {
    return null;
  }

  const payload = embedStreamToResponse(best, {
    tmdbId: query.tmdbId,
    imdbId: query.imdbId,
  });

  return {
    id: query.originalId,
    type: query.type,
    season: query.type === "tv" ? Number(query.season) : undefined,
    episode: query.type === "tv" ? Number(query.episode) : undefined,
    quality: query.quality,
    qualityUsed: payload.qualityUsed,
    multiLang: query.multiLang,
    providers,
    alternates: streams
      .filter((s) => s.url !== best.url)
      .slice(0, 5)
      .map((s) => ({
        provider: s.provider,
        url: s.url,
        title: s.title,
        format: s.format,
      })),
    ...payload,
  };
}

export async function handleLinkRequest(searchParams, options = {}) {
  const query = parseLinkQuery(searchParams);

  let resolved;
  try {
    resolved = await resolveContentId(query.id, query.type);
  } catch (error) {
    if (query.source === "embed" || query.format === "mp4") {
      throw error;
    }
    if (/^tt\d+$/i.test(query.id.trim())) {
      const hint = new Error(
        `${error.message} Use a numeric TMDB id (e.g. 533535 for Deadpool) or set TMDB_API_KEY.`
      );
      hint.status = error.status || 400;
      throw hint;
    }
    resolved = { tmdbId: query.id.trim(), imdbId: null, title: null, year: null };
  }

  const enriched = {
    ...query,
    originalId: query.id,
    tmdbId: resolved.tmdbId,
    imdbId: resolved.imdbId,
  };

  const tryEmbed = query.source !== "vidlink" && query.format !== "hls";
  const tryVidlink = query.source !== "embed";

  if (tryEmbed) {
    const embedResult = await fetchEmbedLinks(enriched);
    if (embedResult) {
      return finalizeResponse(embedResult, query, options);
    }

    if (query.source === "embed") {
      const error = new Error("No MP4 stream found from embed providers for this title.");
      error.status = 404;
      throw error;
    }
  }

  if (tryVidlink) {
    const vidlink = await fetchVidlinkLinks(enriched);

    if (query.format === "mp4" && vidlink.streamType !== "mp4") {
      const error = new Error(
        "No MP4 stream found. Try another title or set TMDB_API_KEY for embed providers."
      );
      error.status = 404;
      throw error;
    }

    return finalizeResponse(vidlink, query, options);
  }

  const error = new Error("No stream source matched the request.");
  error.status = 404;
  throw error;
}
