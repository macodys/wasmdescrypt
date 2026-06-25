import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleLinkRequest } from "./lib/link-handler.mjs";
import { fetchVidLinkStream } from "./lib/stream-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

async function proxyStream(token, multiLang, { type, season, episode }) {
  return fetchVidLinkStream(token, multiLang, { type, season, episode });
}

function isAllowedProxyUrl(target) {
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveMediaUrl(relativeOrAbsolute, baseUrl) {
  const base = new URL(baseUrl);
  const resolved = new URL(relativeOrAbsolute, baseUrl);

  if (base.search) {
    const merged = new URLSearchParams(resolved.search);
    for (const [key, value] of base.searchParams.entries()) {
      if (!merged.has(key)) {
        merged.set(key, value);
      }
    }
    resolved.search = merged.toString();
  }

  return resolved.toString();
}

function rewriteM3u8(content, baseUrl) {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
          const absolute = resolveMediaUrl(uri, baseUrl);
          return `URI="/api/proxy?url=${encodeURIComponent(absolute)}"`;
        });
      }

      if (trimmed.startsWith("#")) {
        return line;
      }

      const absolute = resolveMediaUrl(trimmed, baseUrl);
      return `/api/proxy?url=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}

function buildUpstreamHeaders(targetUrl) {
  const headers = {
    Accept: "*/*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  try {
    const parsed = new URL(targetUrl);
    const headersParam = parsed.searchParams.get("headers");
    if (!headersParam) {
      return headers;
    }

    const custom = JSON.parse(headersParam);
    if (custom.referer) {
      headers.Referer = custom.referer;
    }
    if (custom.origin) {
      headers.Origin = custom.origin;
    }
  } catch {
    // ignore malformed headers param
  }

  return headers;
}

async function proxyMedia(targetUrl, res) {
  if (!isAllowedProxyUrl(targetUrl)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const response = await fetch(targetUrl, {
    headers: buildUpstreamHeaders(targetUrl),
  });

  if (!response.ok) {
    res.writeHead(response.status);
    res.end(`Upstream error (${response.status})`);
    return;
  }

  const contentType = response.headers.get("content-type") || "";
  const isManifest =
    targetUrl.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("m3u8");

  if (isManifest) {
    const text = await response.text();
    const rewritten = rewriteM3u8(text, targetUrl);
    res.writeHead(200, {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    res.end(rewritten);
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": contentType || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  });
  res.end(buffer);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const pathname = urlPath === "/" || urlPath === "" ? "/index.html" : urlPath;
  const relativePath = pathname.replace(/^\//, "").replace(/\.\./g, "");
  const filePath = path.join(__dirname, relativePath);
  const resolvedPath = path.resolve(filePath);

  const rootDir = path.resolve(__dirname);

  if (
    resolvedPath !== rootDir &&
    !resolvedPath.startsWith(rootDir + path.sep)
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(resolvedPath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/link") {
    try {
      const body = await handleLinkRequest(url.searchParams);
      sendJson(res, 200, body);
    } catch (error) {
      sendJson(res, error.status || 502, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    const token = url.searchParams.get("token");
    const multiLang = url.searchParams.get("multiLang") === "1";
    const season = url.searchParams.get("season");
    const episode = url.searchParams.get("episode");
    const type =
      url.searchParams.get("type") === "tv" || (season && episode) ? "tv" : "movie";

    if (!token) {
      sendJson(res, 400, { error: "Missing token query parameter" });
      return;
    }

    try {
      const data = await proxyStream(token, multiLang, { type, season, episode });
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/proxy") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      sendJson(res, 400, { error: "Missing url query parameter" });
      return;
    }

    try {
      await proxyMedia(targetUrl, res);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Stop the other server, then run npm start again.");
    console.error(`  PowerShell: Get-NetTCPConnection -LocalPort ${PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`Token generator running at http://localhost:${PORT}`);
  console.log(`Stream link API: http://localhost:${PORT}/api/link?id=786892`);
});
