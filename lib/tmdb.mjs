const TMDB_BASE = "https://api.themoviedb.org/3";

export function getTmdbApiKey() {
  return process.env.TMDB_API_KEY || process.env.TMDB_API_KEYS?.split(",")[0]?.trim() || "";
}

async function tmdbFetch(path) {
  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    const error = new Error(
      "TMDB_API_KEY is not set. Add it in Vercel project settings for optional IMDb id lookup."
    );
    error.status = 503;
    throw error;
  }

  const url = `${TMDB_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`TMDB error (${response.status}): ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

export async function resolveContentId(id, type) {
  const trimmed = String(id).trim();

  if (/^tt\d+$/i.test(trimmed)) {
    const findType = type === "tv" ? "tv" : "movie";
    const data = await tmdbFetch(
      `/find/${encodeURIComponent(trimmed)}?external_source=imdb_id`
    );
    const results = data[`${findType}_results`] || [];
    if (results.length === 0) {
      const error = new Error(`No TMDB match for IMDb id ${trimmed}`);
      error.status = 404;
      throw error;
    }

    const item = results[0];
    return {
      tmdbId: String(item.id),
      imdbId: trimmed.toLowerCase(),
      title: item.title || item.name || "",
      year: (item.release_date || item.first_air_date || "").slice(0, 4),
    };
  }

  return {
    tmdbId: trimmed,
    imdbId: null,
    title: null,
    year: null,
  };
}

export async function fetchTmdbDetails(tmdbId, type) {
  const mediaType = type === "tv" ? "tv" : "movie";
  const data = await tmdbFetch(
    `/${mediaType}/${encodeURIComponent(tmdbId)}?append_to_response=external_ids`
  );

  return {
    tmdbId: String(data.id),
    imdbId: data.external_ids?.imdb_id || null,
    title: data.title || data.name || "",
    year: (data.release_date || data.first_air_date || "").slice(0, 4),
  };
}
