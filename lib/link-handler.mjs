import { fetchStreamData, parseLinkQuery, resolveStreamLinks } from "./stream-core.mjs";
import { generateToken } from "./wasm-token.mjs";

export async function handleLinkRequest(searchParams) {
  const query = parseLinkQuery(searchParams);
  const token = await generateToken(query.id);
  const streamData = await fetchStreamData(token, query.multiLang, {
    type: query.type,
    season: query.season,
    episode: query.episode,
  });
  const links = resolveStreamLinks(streamData, query.quality);

  return {
    id: query.id,
    type: query.type,
    season: query.type === "tv" ? Number(query.season) : undefined,
    episode: query.type === "tv" ? Number(query.episode) : undefined,
    quality: query.quality,
    qualityUsed: links.qualityUsed,
    multiLang: query.multiLang,
    streamType: links.streamType,
    url: links.url,
    master: links.master,
    qualityUrl: links.qualityUrl,
    qualities: links.qualities,
    token,
  };
}
