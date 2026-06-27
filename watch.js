import { createStormHlsConfig, isStormUrl, pickHlsSourceUrl } from "./lib/storm-hls.mjs";

const statusEl = document.getElementById("watch-status");
const statusText = document.getElementById("watch-status-text");
const videoEl = document.getElementById("watch-video");
const errorEl = document.getElementById("watch-error");
const noteEl = document.getElementById("watch-note");
const streamUrlEl = document.getElementById("stream-url");
const downloadLink = document.getElementById("download-link");
const copyUrlBtn = document.getElementById("copy-url-btn");
const retryBtn = document.getElementById("retry-btn");

let hlsInstance = null;

function setStatus(kind, message) {
  statusEl.className = `status status--${kind}`;
  statusText.textContent = message;
}

function showError(message, note = "") {
  errorEl.hidden = false;
  errorEl.textContent = message;
  retryBtn.hidden = false;
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

function playHlsFromUrl(sourceUrl, stormBaseUrl) {
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

    const config =
      stormBaseUrl && isStormUrl(stormBaseUrl)
        ? createStormHlsConfig(stormBaseUrl)
        : { enableWorker: true, lowLatencyMode: false };

    hlsInstance = new Hls(config);

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

async function playHls(data, linkQuery) {
  const stormUrl = pickHlsSourceUrl(data);
  const manifestUrl = data.manifestUrl || `/api/manifest?${linkQuery.toString()}`;

  let directError = null;

  try {
    await playHlsFromUrl(stormUrl, stormUrl);
    setStatus("ready", "Playing extracted HLS");
    return;
  } catch (error) {
    directError = error;
    stopPlayback();
  }

  try {
    await playHlsFromUrl(manifestUrl);
    setStatus("ready", "Playing HLS via proxy");
    return;
  } catch (proxyError) {
    const detail = proxyError.message || "proxy failed";
    const directDetail = directError?.message || "direct failed";
    throw new Error(
      `Could not load HLS (direct: ${directDetail}; proxy: ${detail}). Storm links expire — try Retry. For offline players use the m3u8 URL with FetchV or download the .m3u for VLC.`
    );
  }
}

async function fetchLink(linkQuery) {
  const response = await fetch(`/api/link?${linkQuery.toString()}&_=${Date.now()}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `API error (${response.status})`);
  }
  return data;
}

async function start() {
  const linkQuery = buildLinkQuery(new URLSearchParams(window.location.search));

  stopPlayback();
  errorEl.hidden = true;
  errorEl.textContent = "";
  noteEl.hidden = true;
  noteEl.textContent = "";
  retryBtn.hidden = true;
  setStatus("loading", "Loading stream…");

  const data = await fetchLink(linkQuery);

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

  await playHls(data, linkQuery);
}

copyUrlBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(streamUrlEl.value);
  copyUrlBtn.textContent = "Copied";
  setTimeout(() => {
    copyUrlBtn.textContent = "Copy m3u8 URL";
  }, 1500);
});

retryBtn.addEventListener("click", () => {
  start().catch((error) => {
    showError(error.message);
  });
});

start().catch((error) => {
  showError(error.message);
});
