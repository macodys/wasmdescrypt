const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const formEl = document.getElementById("token-form");
const outputEl = document.getElementById("output");
const tokenValueEl = document.getElementById("token-value");
const tokenHexEl = document.getElementById("token-hex");
const playlistValueEl = document.getElementById("playlist-value");
const masterPlaylistValueEl = document.getElementById("master-playlist-value");
const streamTypeEl = document.getElementById("stream-type");
const sourceDetailsSummary = document.getElementById("source-details-summary");
const contentIdInput = document.getElementById("content-id");
const contentTypeInputs = document.querySelectorAll('input[name="content-type"]');
const tvFieldsEl = document.getElementById("tv-fields");
const seasonInput = document.getElementById("season");
const episodeInput = document.getElementById("episode");
const qualitySelect = document.getElementById("quality");
const multiLangInput = document.getElementById("multi-lang");
const generateBtn = document.getElementById("generate-btn");
const copyTokenBtn = document.getElementById("copy-token-btn");
const copyPlaylistBtn = document.getElementById("copy-playlist-btn");
const copyMasterBtn = document.getElementById("copy-master-btn");
const playBtn = document.getElementById("play-btn");
const regeneratePlayBtn = document.getElementById("regenerate-play-btn");
const urlWarningEl = document.getElementById("url-warning");
const playerWrapEl = document.getElementById("player-wrap");
const previewVideoEl = document.getElementById("preview-video");
const playerErrorEl = document.getElementById("player-error");
const manualStreamEl = document.getElementById("manual-stream");
const apiUrlValueEl = document.getElementById("api-url-value");
const pasteJsonEl = document.getElementById("paste-json");
const applyJsonBtn = document.getElementById("apply-json-btn");
const copyApiBtn = document.getElementById("copy-api-btn");

const VIDLINK_ORIGIN = "https://vidlink.pro";

let hlsInstance = null;
let currentStreamType = null;
let currentQualityUrl = null;
let hasStreamBackend = false;

function buildVidLinkApiUrl(token, multiLang, options) {
  const multiLangParam = multiLang ? 1 : 0;

  if (options.type === "tv") {
    return `${VIDLINK_ORIGIN}/api/b/tv/${encodeURIComponent(token)}/${encodeURIComponent(options.season)}/${encodeURIComponent(options.episode)}?multiLang=${multiLangParam}`;
  }

  return `${VIDLINK_ORIGIN}/api/b/movie/${encodeURIComponent(token)}?multiLang=${multiLangParam}`;
}

function parseStormHeaders(url) {
  try {
    const headersParam = new URL(url).searchParams.get("headers");
    if (!headersParam) {
      return {};
    }
    return JSON.parse(headersParam);
  } catch {
    return {};
  }
}

function createHlsConfig() {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    xhrSetup(xhr, url) {
      const storm = parseStormHeaders(url);
      if (storm.referer) {
        xhr.setRequestHeader("Referer", storm.referer);
      }
      if (storm.origin) {
        xhr.setRequestHeader("Origin", storm.origin);
      }
    },
  };
}

async function detectStreamBackend() {
  try {
    const response = await fetch("/api/stream?token=ping", {
      signal: AbortSignal.timeout(2500),
    });
    return response.status === 400 || response.status === 502 || response.ok;
  } catch {
    return false;
  }
}

function setManualStreamMode(token, options) {
  manualStreamEl.hidden = false;
  apiUrlValueEl.textContent = buildVidLinkApiUrl(token, multiLangInput.checked, options);
}

function hideManualStreamMode() {
  manualStreamEl.hidden = true;
  apiUrlValueEl.textContent = "";
  pasteJsonEl.value = "";
}

function setStatus(kind, message) {
  statusEl.className = `status status--${kind}`;
  statusText.textContent = message;
}

function b64urlToHex(token) {
  const pad = "=".repeat((4 - (token.length % 4)) % 4);
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  return [...binary]
    .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function toQualityPlaylistUrl(masterPlaylistUrl, quality) {
  const url = new URL(masterPlaylistUrl);
  url.pathname = url.pathname.replace(/\/playlist\.m3u8$/i, `/${quality}/index.m3u8`);
  return url.toString();
}

function pickQualityEntry(qualities, quality) {
  const keys = Object.keys(qualities).sort((a, b) => Number(b) - Number(a));
  if (keys.length === 0) {
    return null;
  }

  if (qualities[quality]?.url) {
    return { key: quality, entry: qualities[quality] };
  }

  const fallbackKey =
    keys.find((key) => Number(key) <= Number(quality)) || keys[keys.length - 1];

  return { key: fallbackKey, entry: qualities[fallbackKey] };
}

function formatHlsSources(masterUrl, quality, qualityUrl) {
  return `Master (playlist.m3u8):\n${masterUrl}\n\n${quality}p direct (index.m3u8):\n${qualityUrl}`;
}

function preferHlsQuality(hls, quality) {
  const target = Number(quality);
  if (!Number.isFinite(target) || !hls.levels?.length) {
    return;
  }

  let bestIdx = -1;
  let bestDiff = Infinity;

  hls.levels.forEach((level, index) => {
    const height = level.height || 0;
    const diff = Math.abs(height - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = index;
    }
  });

  if (bestIdx >= 0) {
    hls.currentLevel = bestIdx;
  }
}

function formatMp4Sources(qualities) {
  return Object.keys(qualities)
    .sort((a, b) => Number(b) - Number(a))
    .map((key) => `${key}p: ${qualities[key].url}`)
    .join("\n\n");
}

function resolveStreamUrl(data, quality) {
  const stream = data?.stream;
  if (!stream) {
    throw new Error("Stream response did not include stream data");
  }

  if (stream.type === "hls") {
    if (!stream.playlist) {
      throw new Error("HLS stream did not include a playlist URL");
    }

    const qualityUrl = toQualityPlaylistUrl(stream.playlist, quality);

    return {
      type: "hls",
      playUrl: stream.playlist,
      qualityUrl,
      sourceDetails: formatHlsSources(stream.playlist, quality, qualityUrl),
      sourceLabel: "HLS playlists",
      statusMessage: `Token and HLS master playlist generated (${quality}p in player)`,
    };
  }

  if (stream.type === "file" && stream.qualities) {
    const picked = pickQualityEntry(stream.qualities, quality);
    if (!picked?.entry?.url) {
      throw new Error("MP4 stream did not include any quality URLs");
    }

    const requestedDifferentQuality = picked.key !== quality;

    return {
      type: "mp4",
      playUrl: picked.entry.url,
      sourceDetails: formatMp4Sources(stream.qualities),
      sourceLabel: "All MP4 qualities",
      qualityUsed: picked.key,
      statusMessage: requestedDifferentQuality
        ? `Token and MP4 link generated (${picked.key}p — ${quality}p not available)`
        : `Token and MP4 link generated (${picked.key}p)`,
    };
  }

  throw new Error(`Unsupported stream type: ${stream.type || "unknown"}`);
}

function validateHlsUrl(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, message: "URL is not valid." };
  }

  if (parsed.pathname.includes("%2F") || parsed.pathname.includes("%2f")) {
    return {
      valid: false,
      message:
        "This URL looks broken (path is over-encoded). For TV shows, select TV series and enter season/episode — do not use Movie.",
    };
  }

  if (!parsed.pathname.includes(".m3u8")) {
    return { valid: false, message: "URL is not an m3u8 playlist." };
  }

  if (parsed.hostname.includes("vodvidl.site")) {
    if (!parsed.searchParams.has("auth")) {
      return {
        valid: false,
        message:
          "This HLS URL is missing the auth= parameter. Regenerate with the correct content type (TV vs Movie).",
      };
    }

    if (!/^\/proxy\/wiwii\/[a-f0-9]+\//i.test(parsed.pathname)) {
      return {
        valid: false,
        message: "Storm proxy path looks invalid. Try regenerating the link.",
      };
    }
  }

  return { valid: true, message: "" };
}

function setUrlWarning(message) {
  if (!message) {
    urlWarningEl.hidden = true;
    urlWarningEl.textContent = "";
    return;
  }

  urlWarningEl.hidden = false;
  urlWarningEl.textContent = message;
}

function showResults({ token, streamType, playUrl, qualityUrl, sourceDetails, sourceLabel, statusMessage }) {
  currentStreamType = streamType;
  currentQualityUrl = streamType === "hls" ? qualityUrl : null;
  copyMasterBtn.hidden = streamType !== "hls";

  if (streamType === "hls") {
    const check = validateHlsUrl(playUrl);
    setUrlWarning(
      check.valid
        ? hasStreamBackend
          ? "HLS uses master playlist.m3u8. For VLC, copy the URL above (includes ?auth=…)."
          : "Static mode: master playlist works in VLC. In-browser HLS may be blocked by CORS without npm start."
        : check.message
    );
  } else {
    setUrlWarning("MP4 links usually work in VLC and the browser player.");
  }

  stopPreview();
  tokenValueEl.textContent = token;
  tokenHexEl.textContent = b64urlToHex(token);
  playlistValueEl.textContent = playUrl;
  masterPlaylistValueEl.textContent = sourceDetails;
  streamTypeEl.textContent = streamType.toUpperCase();
  sourceDetailsSummary.textContent = sourceLabel;
  outputEl.hidden = false;
  setStatus("ready", statusMessage);

  if (streamType === "hls" && validateHlsUrl(playUrl).valid) {
    playPreview();
  }
}

function stopPreview() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  previewVideoEl.removeAttribute("src");
  previewVideoEl.load();
  playerWrapEl.hidden = true;
  playerErrorEl.hidden = true;
  playerErrorEl.textContent = "";
  regeneratePlayBtn.hidden = true;
}

function toProxiedMediaUrl(url) {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

function playHlsUrl(url) {
  const quality = qualitySelect.value;
  const sourceUrl = hasStreamBackend ? toProxiedMediaUrl(url) : url;
  hlsInstance = new Hls(hasStreamBackend ? { enableWorker: true, lowLatencyMode: false } : createHlsConfig());

  hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
    preferHlsQuality(hlsInstance, quality);
    playerErrorEl.hidden = true;
    playerErrorEl.textContent = "";
    previewVideoEl.play().catch(showPlayerError);
  });

  hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      return;
    }

    const detail = data.details || data.type || "unknown error";
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      showPlayerError(
        hasStreamBackend
          ? `HLS network error (${detail}). Click Regenerate & play for a fresh link — storm URLs expire after a few hours.`
          : `HLS network error (${detail}). Copy the master URL into VLC, or run npm start for proxied playback.`
      );
      return;
    }

    showPlayerError(`HLS error: ${detail}`);
  });

  hlsInstance.loadSource(sourceUrl);
  hlsInstance.attachMedia(previewVideoEl);
}

function playPreview() {
  const url = playlistValueEl.textContent.trim();
  if (!url) return;

  stopPreview();
  playerWrapEl.hidden = false;

  if (currentStreamType === "mp4") {
    previewVideoEl.src = url;
    previewVideoEl.play().catch(showPlayerError);
    return;
  }

  const check = validateHlsUrl(url);
  if (!check.valid) {
    showPlayerError(check.message);
    return;
  }

  if (!window.Hls) {
    showPlayerError("HLS player failed to load. Restart the server and refresh the page.");
    return;
  }

  if (window.Hls.isSupported()) {
    playHlsUrl(url);
    return;
  }

  if (previewVideoEl.canPlayType("application/vnd.apple.mpegurl")) {
    previewVideoEl.src = hasStreamBackend ? toProxiedMediaUrl(url) : url;
    previewVideoEl.play().catch(showPlayerError);
    return;
  }

  showPlayerError("HLS is not supported in this browser.");
}

function showPlayerError(message) {
  playerErrorEl.hidden = false;
  playerErrorEl.textContent = message;
  regeneratePlayBtn.hidden = currentStreamType !== "hls";
}

async function loadRuntime() {
  setStatus("loading", "Loading libsodium…");

  const sodium = await import("libsodium-wrappers");
  await sodium.default.ready;
  window.sodium = sodium.default;

  setStatus("loading", "Loading WebAssembly module…");

  const go = new Dm();
  const response = await fetch("./fu.wasm");
  if (!response.ok) {
    throw new Error(`Failed to fetch fu.wasm (${response.status})`);
  }

  const wasmBytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
  go.run(instance);

  await waitForApi();
}

function waitForApi(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();

    const check = () => {
      if (typeof window.getAdv === "function") {
        resolve();
        return;
      }
      if (performance.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for WASM API"));
        return;
      }
      requestAnimationFrame(check);
    };

    check();
  });
}

function generateAdvToken(contentId) {
  if (typeof window.getAdv !== "function") {
    throw new Error("WASM runtime is not ready");
  }

  const token = window.getAdv(String(contentId).trim());
  if (!token) {
    throw new Error("getAdv returned an empty token");
  }

  return token;
}

function getContentType() {
  return [...contentTypeInputs].find((input) => input.checked)?.value || "movie";
}

function updateContentTypeUi() {
  const isTv = getContentType() === "tv";
  tvFieldsEl.hidden = !isTv;
  contentIdInput.placeholder = isTv ? "e.g. 76479" : "e.g. 786892";
}

function parseVidLinkInput(value) {
  const trimmed = value.trim();
  const match = trimmed.match(
    /vidlink\.pro\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/i
  );

  if (!match) {
    return null;
  }

  return {
    type: match[1].toLowerCase() === "tv" ? "tv" : "movie",
    contentId: match[2],
    season: match[3] || "1",
    episode: match[4] || "1",
  };
}

function applyVidLinkInput(value) {
  const parsed = parseVidLinkInput(value);
  if (!parsed) {
    return false;
  }

  contentIdInput.value = parsed.contentId;
  seasonInput.value = parsed.season;
  episodeInput.value = parsed.episode;

  for (const input of contentTypeInputs) {
    input.checked = input.value === parsed.type;
  }

  updateContentTypeUi();
  return true;
}

function isBrokenHlsPlaylist(url) {
  if (!url) {
    return true;
  }

  return !validateHlsUrl(url).valid;
}

async function requestStream(token, multiLang, options) {
  if (hasStreamBackend) {
    const params = new URLSearchParams({
      token,
      multiLang: multiLang ? "1" : "0",
      type: options.type,
    });

    if (options.type === "tv") {
      params.set("season", options.season);
      params.set("episode", options.episode);
    }

    const response = await fetch(`/api/stream?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Stream API failed (${response.status})`);
    }

    return data;
  }

  const apiUrl = buildVidLinkApiUrl(token, multiLang, options);
  const referer =
    options.type === "tv"
      ? `${VIDLINK_ORIGIN}/tv/0/${options.season}/${options.episode}`
      : `${VIDLINK_ORIGIN}/`;

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: referer,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`VidLink API error (${response.status}): ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

async function fetchStreamData(token, multiLang, options) {
  let data = await requestStream(token, multiLang, options);

  const playlist = data?.stream?.playlist;
  if (
    options.type === "movie" &&
    data?.stream?.type === "hls" &&
    isBrokenHlsPlaylist(playlist)
  ) {
    data = await requestStream(token, multiLang, {
      type: "tv",
      season: options.season || seasonInput.value.trim() || "1",
      episode: options.episode || episodeInput.value.trim() || "1",
    });
  }

  if (data?.stream?.type === "hls" && isBrokenHlsPlaylist(data?.stream?.playlist)) {
    throw new Error(
      "This ID looks like a TV series. Select TV series, set season and episode (e.g. 1 / 1), then generate again."
    );
  }

  return data;
}

async function generateAll(contentId, quality, multiLang, options) {
  setStatus("loading", "Generating token and fetching stream…");
  generateBtn.disabled = true;

  try {
    const token = generateAdvToken(contentId);
    hideManualStreamMode();

    let data;
    try {
      data = await fetchStreamData(token, multiLang, options);
    } catch (error) {
      if (!hasStreamBackend) {
        tokenValueEl.textContent = token;
        tokenHexEl.textContent = b64urlToHex(token);
        outputEl.hidden = false;
        setManualStreamMode(token, options);
        setStatus(
          "ready",
          "Token ready. Open the VidLink API link or paste stream JSON below (static mode — no stream proxy)."
        );
        return;
      }
      throw error;
    }

    const resolved = resolveStreamUrl(data, quality);
    const label =
      options.type === "tv"
        ? `S${options.season}E${options.episode} · ${resolved.statusMessage}`
        : resolved.statusMessage;

    showResults({
      token,
      streamType: resolved.type,
      playUrl: resolved.playUrl,
      qualityUrl: resolved.qualityUrl,
      sourceDetails: resolved.sourceDetails,
      sourceLabel: resolved.sourceLabel,
      statusMessage: label,
    });
  } catch (error) {
    setStatus("error", error.message);
    throw error;
  } finally {
    generateBtn.disabled = false;
  }
}

function applyPastedStreamJson() {
  const raw = pasteJsonEl.value.trim();
  if (!raw) {
    setStatus("error", "Paste stream JSON first.");
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    setStatus("error", "Invalid JSON.");
    return;
  }

  try {
    const resolved = resolveStreamUrl(data, qualitySelect.value);
    const token = tokenValueEl.textContent.trim() || "(manual)";

    showResults({
      token,
      streamType: resolved.type,
      playUrl: resolved.playUrl,
      qualityUrl: resolved.qualityUrl,
      sourceDetails: resolved.sourceDetails,
      sourceLabel: resolved.sourceLabel,
      statusMessage: resolved.statusMessage,
    });
  } catch (error) {
    setStatus("error", error.message);
  }
}

function readFormOptions() {
  const type = getContentType();
  const season = seasonInput.value.trim() || "1";
  const episode = episodeInput.value.trim() || "1";

  if (type === "tv" && (!seasonInput.value.trim() || !episodeInput.value.trim())) {
    throw new Error("Season and episode are required for TV series");
  }

  return { type, season, episode };
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  generateAll(
    contentIdInput.value,
    qualitySelect.value,
    multiLangInput.checked,
    readFormOptions()
  ).catch(() => {});
});

for (const input of contentTypeInputs) {
  input.addEventListener("change", updateContentTypeUi);
}

contentIdInput.addEventListener("input", () => {
  applyVidLinkInput(contentIdInput.value);
});

contentIdInput.addEventListener("paste", () => {
  setTimeout(() => applyVidLinkInput(contentIdInput.value), 0);
});

async function copyText(button, text) {
  if (!text) return;

  const original = button.textContent;

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied!";
  } catch {
    button.textContent = "Failed";
  }

  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

copyTokenBtn.addEventListener("click", () => {
  copyText(copyTokenBtn, tokenValueEl.textContent);
});

copyPlaylistBtn.addEventListener("click", () => {
  copyText(copyPlaylistBtn, playlistValueEl.textContent);
});

copyMasterBtn.addEventListener("click", () => {
  copyText(copyMasterBtn, currentQualityUrl);
});

copyApiBtn.addEventListener("click", () => {
  copyText(copyApiBtn, apiUrlValueEl.textContent);
});

applyJsonBtn.addEventListener("click", applyPastedStreamJson);

playBtn.addEventListener("click", playPreview);

regeneratePlayBtn.addEventListener("click", () => {
  generateAll(
    contentIdInput.value,
    qualitySelect.value,
    multiLangInput.checked,
    readFormOptions()
  ).catch(() => {});
});

loadRuntime()
  .then(async () => {
    hasStreamBackend = await detectStreamBackend();
    formEl.hidden = false;
    updateContentTypeUi();
    return generateAll(
      contentIdInput.value,
      qualitySelect.value,
      multiLangInput.checked,
      readFormOptions()
    );
  })
  .catch((error) => {
    console.error(error);
    if (statusText.textContent === "Initializing…") {
      setStatus("error", error.message);
    }
  });
