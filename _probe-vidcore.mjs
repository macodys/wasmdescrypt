import fs from "fs";

const s = fs.readFileSync("_vidcore-281.js", "utf8");
const patterns = [
  /https?:\/\/[^"'`\s)]+/g,
  /\/api\/[a-zA-Z0-9_/-]+/g,
  /"en"[^,]{0,200}/g,
  /accelerated_[a-z]+/g,
  /getStream|fetchStream|sourceUrl|playlist|\.m3u8|\.mp4/gi,
];

for (const re of patterns) {
  const m = [...new Set(s.match(re) || [])];
  if (m.length) {
    console.log("\n", re, "=>", m.length);
    console.log(m.slice(0, 30).join("\n"));
  }
}
