import { createStormHlsConfig, pickHlsSourceUrl } from "./lib/storm-hls.mjs";

const statusEl = document.getElementById("watch-status");
const statusText = document.getElementById("watch-status-text");
const videoEl = document.getElementById("watch-video");
const errorEl = document.getElementById("watch-error");
const downloadLink = document.getElementById("download-link");

let hlsInstance = null;

function setStatus(kind, message) {
  statusEl.className = `status status--${kind}`;
  statusText.textContent = message;
}

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
  setStatus("error", "Playback failed");
}

function buildLinkQuery(searchParams) {
  const query = new URLSearchParams();
  const id = searchParams.get("id") || searchParams.get("contentId");
  if (!id) {
    throw new Error("Missing id in URL. Example: /watch?id=157336");
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

function playHls(url) {
  if (!window.Hls) {
    throw new Error("HLS player failed to load.");
  }

  if (window.Hls.isSupported()) {
    hlsInstance = new Hls(createStormHlsConfig());
    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().catch((error) => showError(error.message));
    });
    hlsInstance.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) {
        return;
      }
      showError(`HLS error: ${data.details || data.type}. Regenerate the link if it expired.`);
    });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(videoEl);
    return Promise.resolve();
  }

  if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
    videoEl.src = url;
    return videoEl.play();
  }

  throw new Error("HLS is not supported in this browser.");
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

  setStatus("ready", `Playing HLS (${data.qualityUsed || "auto"}p)`);
  await playHls(hlsUrl);
}

start().catch((error) => {
  showError(error.message);
});
