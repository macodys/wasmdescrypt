import { fetchStreamData, parseLinkQuery, resolveStreamLinks } from "./stream-core.mjs";
import { extractStormRequestHeaders, isStormUrl, pickHlsSourceUrl } from "./storm-hls.mjs";
import {
  applyProxyToLinkResponse,
  fetchStormManifest,
  getStormProxyStatus,
} from "./media-proxy.mjs";
import { generateToken } from "./wasm-token.mjs";
import { resolveContentId } from "./tmdb.mjs";

function buildPlayerQuery(body) {
  const query = new URLSearchParams({ id: String(body.id || body.tmdbId) });
  if (body.type === "tv") {
    query.set("type", "tv");
    query.set("season", String(body.season));
    query.set("episode", String(body.episode));
  }
  if (body.quality && body.quality !== "1080") {
    query.set("quality", String(body.quality));
  }
  return query;
}

function buildVidlinkPageUrl(body) {
  const id = String(body.id || body.tmdbId);
  if (body.type === "tv") {
    return `https://vidlink.pro/tv/${encodeURIComponent(id)}/${encodeURIComponent(body.season)}/${encodeURIComponent(body.episode)}`;
  }
  return `https://vidlink.pro/movie/${encodeURIComponent(id)}`;
}

async function enrichPlayerUrls(body, baseOrigin) {
  if (!baseOrigin) {
    return body;
  }

  const playerQuery = buildPlayerQuery(body);
  const embedUrl = buildVidlinkPageUrl(body);
  const enriched = {
    ...body,
    playerUrl: `${baseOrigin}/watch.html?${playerQuery.toString()}`,
    embedUrl,
    stormProxy: await getStormProxyStatus(),
  };

  if (body.streamType === "hls") {
    const downloadQuery = new URLSearchParams(playerQuery);
    downloadQuery.set("source", "vidlink");
    enriched.downloadUrl = `${baseOrigin}/api/vlc?${downloadQuery.toString()}`;
    enriched.manifestUrl = `${baseOrigin}/api/manifest?${playerQuery.toString()}`;

    const upstream = body.streamQualityUrl || body.rawQualityUrl || body.rawUrl;
    if (upstream && isStormUrl(upstream)) {
      enriched.plugin = {
        m3u8: upstream,
        headers: extractStormRequestHeaders(upstream),
      };
      enriched.playbackHint =
        "Browser: open playerUrl (direct HLS, then /api/manifest proxy). External: plugin.m3u8 + plugin.headers (FetchV). VLC: downloadUrl. On Vercel set STORM_PROXY_URL if Storm blocks the server.";
    }
  } else if (body.streamType === "mp4") {
    enriched.playbackHint =
      "Open playerUrl in any browser, or paste url into MP4-capable players.";
  }

  return enriched;
}

async function finalizeResponse(body, query, options) {
  const proxied = applyProxyToLinkResponse(body, {
    baseOrigin: options.baseOrigin,
    proxy: query.proxy,
    streamHeaders: body.headers,
  });
  const enriched = await enrichPlayerUrls(proxied, options.baseOrigin);

  if (enriched.streamType === "hls" && options.baseOrigin) {
    const upstream = pickHlsSourceUrl(enriched);
    if (upstream && isStormUrl(upstream)) {
      const manifest = await fetchStormManifest(
        upstream,
        `${options.baseOrigin}/api/proxy?url=`
      );
      enriched.stormUpstream = {
        ok: manifest.ok,
        status: manifest.status,
        viaProxy: manifest.viaProxy,
        error: manifest.error,
      };
      if (manifest.ok) {
        enriched.hlsManifest = manifest.text;
      }
    }
  }

  return enriched;
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

  return await finalizeResponse(vidlink, query, options);
}
