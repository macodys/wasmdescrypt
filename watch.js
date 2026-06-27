import { createStormHlsConfig, pickHlsSourceUrl } from "./lib/storm-hls.mjs";

const statusEl = document.getElementById("watch-status");
const statusText = document.getElementById("watch-status-text");
const videoEl = document.getElementById("watch-video");
const errorEl = document.getElementById("watch-error");
const noteEl = document.getElementById("watch-note");
const streamUrlEl = document.getElementById("stream-url");
const downloadLink = document.getElementById("download-link");
const copyUrlBtn = document.getElementById("copy-url-btn");

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

function stopPlayback() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  videoEl.removeAttribute("src");
  videoEl.load();
}

function playMp4(url) {
  videoEl.src = url;
  return videoEl.play();
}

async function probeManifest(url) {
  const response = await fetch(url, { method: "GET" });
  const contentType = response.headers.get("content-type") || "";
  const text = response.ok ? await response.text() : "";
  return {
    ok: response.ok,
    looksLikeManifest:
      response.ok &&
      (contentType.includes("mpegurl") ||
        contentType.includes("m3u8") ||
        text.trimStart().startsWith("#EXTM3U")),
  };
}

function playHlsFromUrl(sourceUrl, basePlaylistUrl) {
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

    hlsInstance = new Hls(createStormHlsConfig(basePlaylistUrl));
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

async function playHls(upstream) {
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(upstream)}`;

  try {
    const proxied = await probeManifest(proxyUrl);
    if (proxied.looksLikeManifest) {
      await playHlsFromUrl(proxyUrl, upstream);
      setStatus("ready", "Playing HLS via proxy");
      return;
    }
  } catch {
    // try direct
  }

  await playHlsFromUrl(upstream, upstream);
  setStatus("ready", "Playing extracted HLS");
}

async function start() {
  const linkQuery = buildLinkQuery(new URLSearchParams(window.location.search));
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

  if (data.streamType === "mp4") {
    setStatus("ready", `Playing MP4 (${data.qualityUsed || "auto"}p)`);
    await playMp4(data.url);
    return;
  }

  const hlsUrl = pickHlsSourceUrl(data);
  if (!hlsUrl) {
    throw new Error("No HLS URL returned from API.");
  }

  streamUrlEl.value = hlsUrl;
  streamUrlEl.hidden = false;
  copyUrlBtn.hidden = false;

  noteEl.hidden = false;
  noteEl.textContent =
    "This player uses the extracted Storm m3u8 from /api/link. Extensions like FetchV can also read this URL from the field below. Referer: https://megacloud.live/";

  await playHls(hlsUrl);
}

copyUrlBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(streamUrlEl.value);
  copyUrlBtn.textContent = "Copied";
  setTimeout(() => {
    copyUrlBtn.textContent = "Copy m3u8 URL";
  }, 1500);
});

start().catch((error) => {
  showError(
    error.message,
    "Browser playback may be blocked by Storm CORS. Copy the m3u8 URL below for FetchV/IINA/VLC, or download the .m3u playlist."
  );
});
