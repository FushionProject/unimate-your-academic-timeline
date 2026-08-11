import assert from "node:assert/strict";
import fs from "node:fs";

const rootRoute = fs.readFileSync(new URL("../../src/routes/__root.tsx", import.meta.url), "utf8");
const sidebar = fs.readFileSync(
  new URL("../../src/components/sidebar.tsx", import.meta.url),
  "utf8",
);

assert.match(
  rootRoute,
  /<div className="flex min-w-0 flex-1">\s*<Sidebar \/>/,
  "the application sidebar must render independently of public/private route state",
);
assert.doesNotMatch(
  rootRoute,
  /<MusicPlayer\s*\/>|<PomodoroTimer\s*\/>/,
  "timer and music controls must remain absent from the application shell",
);
assert.match(
  sidebar,
  /label: "Pricing", to: "\/pricing"/,
  "the persistent desktop sidebar must include the pricing route",
);

console.log("PASS application shell regression checks");
