import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleLinkRequest } from "./lib/link-handler.mjs";
import { fetchVidLinkStream } from "./lib/stream-core.mjs";
import { proxyMediaRequest, buildStormVlcM3u, isStormHlsUrl } from "./lib/media-proxy.mjs";

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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const pathname = urlPath === "/" || urlPath === "" ? "/index.html" : urlPath;
  const relativePath = pathname.replace(/^\//, "").replace(/\.\./g, "");
  const filePath = path.join(__dirname, relativePath);
  const resolvedPath = path.resolve(filePath);
  const rootDir = path.resolve(__dirname);

  if (resolvedPath !== rootDir && !resolvedPath.startsWith(rootDir + path.sep)) {
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
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/link") {
    try {
      const baseOrigin = `http://${req.headers.host}`;
      const body = await handleLinkRequest(url.searchParams, { baseOrigin });
      sendJson(res, 200, body);
    } catch (error) {
      sendJson(res, error.status || 502, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/vlc") {
    try {
      const baseOrigin = `http://${req.headers.host}`;
      const params = new URLSearchParams(url.searchParams);
      params.set("format", "hls");
      params.set("source", "vidlink");
      params.set("proxy", "0");
      const body = await handleLinkRequest(params, { baseOrigin });

      if (body.streamType !== "hls") {
        sendJson(res, 404, { error: "No HLS stream available for this title." });
        return;
      }

      const upstream = body.qualityUrl || body.url;
      if (!isStormHlsUrl(upstream)) {
        sendJson(res, 404, { error: "VLC playlist helper only supports Storm HLS links." });
        return;
      }

      const playlist = buildStormVlcM3u(upstream);
      res.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Content-Disposition": 'attachment; filename="stream.m3u"',
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(playlist);
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

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/proxy") {
    const targetUrl = url.searchParams.get("url");
    const hdrParam = url.searchParams.get("hdr");

    try {
      await proxyMediaRequest(
        targetUrl,
        hdrParam,
        {
          range: req.headers.range,
          host: req.headers.host,
          proto: "http",
        },
        (status, headers, body) => {
          res.writeHead(status, headers);
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          res.end(body);
        }
      );
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
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`Token generator running at http://localhost:${PORT}`);
  console.log(`Stream link API: http://localhost:${PORT}/api/link?id=786892`);
});
