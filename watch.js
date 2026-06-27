import {
  createStormHlsConfig,
  isStormUrl,
  pickHlsSourceUrl,
  rewriteStormManifestForClient,
} from "./lib/storm-hls.mjs";

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
let manifestBlobUrl = null;

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

  if (manifestBlobUrl) {
    URL.revokeObjectURL(manifestBlobUrl);
    manifestBlobUrl = null;
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

async function fetchStormManifestBlob(stormUrl) {
  const response = await fetch(stormUrl, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`manifest ${response.status}`);
  }

  const text = await response.text();
  if (!text.trimStart().startsWith("#EXTM3U")) {
    throw new Error("invalid manifest");
  }

  const rewritten = rewriteStormManifestForClient(text, stormUrl);
  manifestBlobUrl = URL.createObjectURL(
    new Blob([rewritten], { type: "application/vnd.apple.mpegurl" })
  );
  return manifestBlobUrl;
}

async function probeManifestUrl(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = response.ok ? await response.text() : "";
  return {
    ok: response.ok,
    status: response.status,
    isM3u8: response.ok && text.trimStart().startsWith("#EXTM3U"),
  };
}

async function tryPlay(label, fn) {
  try {
    await fn();
    return label;
  } catch (error) {
    stopPlayback();
    return error;
  }
}

async function playHls(data, linkQuery) {
  const stormUrl = pickHlsSourceUrl(data);
  const manifestUrl = data.manifestUrl || `/api/manifest?${linkQuery.toString()}`;
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(stormUrl)}`;
  const attempts = [];

  const clientBlob = await tryPlay("client manifest", async () => {
    const blobUrl = await fetchStormManifestBlob(stormUrl);
    await playHlsFromUrl(blobUrl, stormUrl);
  });
  if (typeof clientBlob === "string") {
    setStatus("ready", "Playing extracted HLS");
    return;
  }
  attempts.push(String(clientBlob.message || clientBlob));

  const direct = await tryPlay("direct", async () => {
    await playHlsFromUrl(stormUrl, stormUrl);
  });
  if (typeof direct === "string") {
    setStatus("ready", "Playing extracted HLS");
    return;
  }
  attempts.push(String(direct.message || direct));

  const proxyProbe = await probeManifestUrl(proxyUrl);
  if (proxyProbe.isM3u8) {
    const proxied = await tryPlay("proxy", async () => {
      await playHlsFromUrl(proxyUrl);
    });
    if (typeof proxied === "string") {
      setStatus("ready", "Playing HLS via proxy");
      return;
    }
    attempts.push(String(proxied.message || proxied));
  } else {
    attempts.push(`proxy manifest ${proxyProbe.status || "blocked"}`);
  }

  const manifestProbe = await probeManifestUrl(manifestUrl);
  if (manifestProbe.isM3u8) {
    const manifest = await tryPlay("manifest", async () => {
      await playHlsFromUrl(manifestUrl);
    });
    if (typeof manifest === "string") {
      setStatus("ready", "Playing HLS via manifest proxy");
      return;
    }
    attempts.push(String(manifest.message || manifest));
  } else {
    attempts.push(`manifest ${manifestProbe.status || "blocked"}`);
  }

  throw new Error(
    `Could not load HLS (${attempts.join("; ")}). Storm blocks this browser or server IP. Set STORM_PROXY_URL on Vercel, use Retry for a fresh link, or copy the m3u8 URL into FetchV/VLC.`
  );
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
