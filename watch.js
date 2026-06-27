import { createStormHlsConfig, pickHlsSourceUrl } from "./lib/storm-hls.mjs";

const VIDLINK_ORIGIN = "https://vidlink.pro";

const statusEl = document.getElementById("watch-status");
const statusText = document.getElementById("watch-status-text");
const videoEl = document.getElementById("watch-video");
const iframeEl = document.getElementById("watch-iframe");
const errorEl = document.getElementById("watch-error");
const noteEl = document.getElementById("watch-note");
const downloadLink = document.getElementById("download-link");
const embedLink = document.getElementById("embed-link");

let hlsInstance = null;

function setStatus(kind, message) {
  statusEl.className = `status status--${kind}`;
  statusText.textContent = message;
}

function showError(message, note = "") {
  errorEl.hidden = false;
  errorEl.textContent = message;
  if (note) {
    noteEl.hidden = false;
    noteEl.textContent = note;
  }
  setStatus("error", "Playback failed");
}

function buildLinkQuery(searchParams) {
  const query = new URLSearchParams();
  const id = searchParams.get("id") || searchParams.get("contentId");
  if (!id) {
    throw new Error("Missing id in URL. Example: /watch.html?id=157336");
  }

  query.set("id", id.trim());

  const type = searchParams.get("type");
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");
  if (type === "tv" || (season && episode)) {
    query.set("type", "tv");
    query.set("season", season || "1");
    query.set("episode", episode || "1");
  }

  const quality = searchParams.get("quality");
  if (quality) {
    query.set("quality", quality);
  }

  return query;
}

function buildVidlinkPageUrl(linkQuery) {
  const id = linkQuery.get("id");
  if (linkQuery.get("type") === "tv") {
    return `${VIDLINK_ORIGIN}/tv/${encodeURIComponent(id)}/${encodeURIComponent(linkQuery.get("season"))}/${encodeURIComponent(linkQuery.get("episode"))}`;
  }
  return `${VIDLINK_ORIGIN}/movie/${encodeURIComponent(id)}`;
}

function stopPlayback() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  videoEl.hidden = false;
  iframeEl.hidden = true;
  iframeEl.removeAttribute("src");
  videoEl.removeAttribute("src");
  videoEl.load();
}

function showIframe(url, message) {
  stopPlayback();
  videoEl.hidden = true;
  iframeEl.hidden = false;
  iframeEl.src = url;
  noteEl.hidden = false;
  noteEl.textContent = message;
  setStatus("ready", "Playing via VidLink embed");
}

function playMp4(url) {
  videoEl.hidden = false;
  iframeEl.hidden = true;
  videoEl.src = url;
  return videoEl.play();
}

async function probeUrl(url) {
  const response = await fetch(url, { method: "GET" });
  const contentType = response.headers.get("content-type") || "";
  const text = response.ok ? await response.text() : "";
  return {
    ok: response.ok,
    contentType,
    looksLikeManifest:
      response.ok &&
      (contentType.includes("mpegurl") ||
        contentType.includes("m3u8") ||
        text.trimStart().startsWith("#EXTM3U")),
  };
}

function playHlsFromUrl(sourceUrl) {
  return new Promise((resolve, reject) => {
    if (!window.Hls) {
      reject(new Error("HLS player failed to load."));
      return;
    }

    if (!window.Hls.isSupported()) {
      if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        videoEl.src = sourceUrl;
        videoEl.play().then(resolve).catch(reject);
        return;
      }
      reject(new Error("HLS is not supported in this browser."));
      return;
    }

    hlsInstance = new Hls(createStormHlsConfig());
    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().then(resolve).catch(reject);
    });
    hlsInstance.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) {
        return;
      }
      reject(new Error(data.details || data.type || "HLS error"));
    });
    hlsInstance.loadSource(sourceUrl);
    hlsInstance.attachMedia(videoEl);
  });
}

async function playHlsWithFallback(upstream, embedUrl) {
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(upstream)}`;

  try {
    const proxied = await probeUrl(proxyUrl);
    if (proxied.looksLikeManifest) {
      videoEl.hidden = false;
      iframeEl.hidden = true;
      await playHlsFromUrl(proxyUrl);
      setStatus("ready", "Playing HLS via proxy");
      return;
    }
  } catch {
    // try next strategy
  }

  try {
    videoEl.hidden = false;
    iframeEl.hidden = true;
    await playHlsFromUrl(upstream);
    setStatus("ready", "Playing HLS direct");
    return;
  } catch {
    // fall through to embed
  }

  showIframe(
    embedUrl,
    "Storm HLS is blocked in-browser from this host (CORS/Cloudflare). Using the VidLink player instead. For VLC, download the .m3u file below."
  );
}

async function start() {
  const pageQuery = new URLSearchParams(window.location.search);
  const linkQuery = buildLinkQuery(pageQuery);
  const embedUrl = buildVidlinkPageUrl(linkQuery);

  embedLink.href = embedUrl;
  embedLink.hidden = false;

  const response = await fetch(`/api/link?${linkQuery.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API error (${response.status})`);
  }

  stopPlayback();
  errorEl.hidden = true;
  errorEl.textContent = "";
  noteEl.hidden = true;
  noteEl.textContent = "";

  if (data.downloadUrl) {
    downloadLink.href = data.downloadUrl;
    downloadLink.hidden = false;
  } else {
    downloadLink.hidden = true;
  }

  if (data.embedUrl) {
    embedLink.href = data.embedUrl;
  }

  if (data.streamType === "mp4") {
    setStatus("ready", `Playing MP4 (${data.qualityUsed || "auto"}p)`);
    await playMp4(data.url);
    return;
  }

  const hlsUrl = pickHlsSourceUrl(data);
  if (!hlsUrl) {
    throw new Error("No HLS URL returned from API.");
  }

  await playHlsWithFallback(hlsUrl, data.embedUrl || embedUrl);
}

start().catch((error) => {
  showError(
    error.message,
    "If this keeps failing, download the VLC playlist from /api/vlc?id=YOUR_ID and open that file in VLC."
  );
});
