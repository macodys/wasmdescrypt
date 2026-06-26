import { fetchStreamData, parseLinkQuery, resolveStreamLinks } from "./stream-core.mjs";
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

export async function handleLinkRequest(searchParams, options = {}) {
  const query = parseLinkQuery(searchParams);

  if (query.source === "embed") {
    const error = new Error(
      "Embed providers are disabled. Use source=vidlink (default) for extracted VidLink streams."
    );
    error.status = 400;
    throw error;
  }

  let resolved;
  try {
    resolved = await resolveContentId(query.id, query.type);
  } catch (error) {
    if (/^tt\d+$/i.test(query.id.trim())) {
      const hint = new Error(
        `${error.message} Use a numeric VidLink/TMDB content id (e.g. 533535) or set TMDB_API_KEY for IMDb lookup only.`
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

  const vidlink = await fetchVidlinkLinks(enriched);

  if (query.format === "mp4" && vidlink.streamType !== "mp4") {
    const error = new Error(
      "No MP4 stream from VidLink for this title. Try format=hls or another content id."
    );
    error.status = 404;
    throw error;
  }

  if (query.format === "hls" && vidlink.streamType !== "hls") {
    const error = new Error(
      "No HLS stream from VidLink for this title. Try format=mp4 or another content id."
    );
    error.status = 404;
    throw error;
  }

  return finalizeResponse(vidlink, query, options);
}
