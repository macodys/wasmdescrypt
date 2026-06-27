import fs from "fs";

const s = fs.readFileSync("_vidcore-281.js", "utf8");

// string literals 4+ chars
const literals = [...s.matchAll(/"([^"\\]{4,120})"/g)].map((m) => m[1]);
const interesting = literals.filter((x) =>
  /api|movie|stream|source|mp4|m3u8|hls|dash|embed|proxy|token|decrypt|fetch|vidcore|http|\/v\d|accelerated|direct|iframe/i.test(x)
);

console.log("interesting literals:", [...new Set(interesting)].slice(0, 80).join("\n"));

// template-ish concatenations near fetch
const idx = s.indexOf("accelerated_mp4");
console.log("\ncontext accelerated_mp4:", s.slice(Math.max(0, idx - 200), idx + 400));
