import { fetchTmdbDetails } from "../tmdb.mjs";

const DAHMER_MOVIES_API = "https://a.111477.xyz";
const DAHMER_WORKER_API = "https://p.111477.xyz/bulk?u=";

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: `${DAHMER_MOVIES_API}/`,
};

function parseLinks(html) {
  const links = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const rowContent = match[1];
    const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
    const sizeMatch = rowContent.match(/<td[^>]*>(\d+(?:\.\d+)?\s?[KMGT]B)<\/td>/i);

    if (!linkMatch) {
      continue;
    }

    const href = linkMatch[1];
    const text = linkMatch[2].trim();
    const size = sizeMatch ? sizeMatch[1].trim() : "N/A";

    if (text && href !== "../" && /\.(mkv|mp4|avi|webm|m3u8)$/i.test(text)) {
      links.push({ text, href, size });
    }
  }

  return links;
}

async function fetchDirectory(title, year, season) {
  const cleanTitle = title.replace(/:/g, "");
  const variants =
    season !== null
      ? [
          `/tvs/${encodeURIComponent(cleanTitle)}/Season%20${season < 10 ? `0${season}` : season}/`,
          `/tvs/${encodeURIComponent(cleanTitle)}/Season%20${season}/`,
        ]
      : [`/movies/${encodeURIComponent(`${cleanTitle} (${year})`)}/`];

  for (const variant of variants) {
    try {
      const response = await fetch(DAHMER_MOVIES_API + variant, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return { html: await response.text(), dirUrl: DAHMER_MOVIES_API + variant };
      }
    } catch {
      // try next variant
    }
  }

  return null;
}

export async function getDahmermoviesStreams(tmdbId, mediaType = "movie", seasonNum = null, episodeNum = null) {
  const details = await fetchTmdbDetails(tmdbId, mediaType === "tv" ? "tv" : "movie");
  const { title, year } = details;

  if (!title) {
    return [];
  }

  const dir = await fetchDirectory(title, year, mediaType === "tv" ? Number(seasonNum) : null);
  if (!dir) {
    return [];
  }

  let paths = parseLinks(dir.html);

  if (seasonNum !== null && episodeNum !== null) {
    const epStr = String(episodeNum).padStart(2, "0");
    const seStr = String(seasonNum).padStart(2, "0");
    const epFiltered = paths.filter((p) => {
      const name = p.text.toLowerCase();
      return name.includes(`s${seStr}e${epStr}`) || name.includes(`e${epStr}`);
    });
    if (epFiltered.length > 0) {
      paths = epFiltered;
    }
  }

  paths.sort(
    (a, b) => (/2160p|4k/i.test(b.text) ? 1 : 0) - (/2160p|4k/i.test(a.text) ? 1 : 0)
  );

  const streams = [];

  for (const path of paths.slice(0, 8)) {
    let directUrl;
    if (path.href.startsWith("http")) {
      directUrl = path.href;
    } else if (path.href.includes("/movies/") || path.href.includes("/tvs/")) {
      directUrl = DAHMER_MOVIES_API + (path.href.startsWith("/") ? "" : "/") + path.href;
    } else {
      directUrl = dir.dirUrl + path.href;
    }

    directUrl = decodeURI(directUrl.replace(/([^:]\/)\/+/g, "$1"));

    const fileName = path.text;
    const formatMatch = fileName.match(/\.(mkv|mp4|m3u8|avi|webm)$/i);
    const fileFormat = formatMatch ? formatMatch[1].toLowerCase() : "link";
    const resolution = fileName.match(/\b(2160p|1080p|720p|4[Kk])\b/)?.[0] || "1080p";

    streams.push({
      title: `${resolution} | ${fileFormat} | ${path.size}`,
      url: DAHMER_WORKER_API + encodeURI(directUrl),
      quality: resolution.replace(/p/i, "").replace(/4k/i, "2160"),
      provider: "dahmermovies",
      format: fileFormat,
      headers: {
        ...REQUEST_HEADERS,
        Accept: "*/*",
        Range: "bytes=0-",
      },
    });
  }

  return streams;
}
